const fs = require("fs");
const path = require("path");
const defer = require("promise-defer");
const CalendarAPI = require("node-google-calendar");
const columnify = require("columnify");
const os = require("os");
const moment = require("moment-timezone");
require("moment-duration-format");
const strings = require("./strings.js");
let bot = require("../bot.js");
let settings = require("../settings.js");
let init = require("./init.js");
let helpers = require("./helpers.js");
let guilds = require("./guilds.js");
let cal = new CalendarAPI(settings.calendarConfig);
let autoUpdater = [];
let timerCount = [];

//functions
					
function clean(channel, numberMessages, recurse) {
  let calendarPath = path.join(__dirname, "..", "stores", channel.guild.id, "calendar.json");
  let calendar = helpers.readFile(calendarPath);
  channel.messages.fetch({
    limit: numberMessages
  }).then((messages) => { //If the current calendar is deleted
    messages.forEach(function(message) {
      if (message.id === calendar.calendarMessageId) {
        calendar.calendarMessageId = "";
        helpers.writeGuildSpecific(channel.guild.id, calendar, "calendar");
        clearInterval(autoUpdater[channel.guild.id]);
        try {
          delete timerCount[channel.guild.id];
          channel.send("update timer has been killed.");
        } catch (err) {
          helpers.log(err);
        }
      }
    });
    if (messages.size < 2) {
      channel.send("cleaning"); //Send extra message to allow deletion of 1 message.
      clean(channel, 2, false);
    }
    if (messages.size === 100 && recurse) {
      channel.bulkDelete(messages).catch((err) => {
        if(err.code===50034) {
          channel.send("Sorry - Due to Discord limitations, Niles cannot clean messages older than 14 days!");
        }
        helpers.log("clean error in guild " + channel.guild.id + err);
      });
      clean(channel, 100, true);
    } else {
      channel.bulkDelete(messages).catch((err) => {
        if(err.code===50034) {
          channel.send("Sorry - Due to Discord limitations, Niles cannot clean messages older than 14 days!");
        }
        helpers.log("clean error in guild " + channel.guild.id + err);
      });
    }
  }).catch((err) => {
    helpers.log("function clean in guild:" + channel.guild.id + ":" + err);
  });
}

function deleteMessages(message) {
  let pieces = message.content.split(" ");
  let numberMessages = 0;
  let recurse = false;
  if (pieces[1] && !Number.isInteger(parseInt(pieces[1], 10))) {
    return message.channel.send("You can only use a number to delete messages. i.e. `!clean 10`");
  }
  if (parseInt(pieces[1], 10) > 0 && parseInt(pieces[1], 10) < 100) {
    message.channel.send("**WARNING** - This will delete " + pieces[1] + " messages in this channel! Are you sure? **(y/n)**");
    numberMessages = parseInt(pieces[1], 10);
  }
  if (parseInt(pieces[1], 10) === 100) {
    message.channel.send("**WARNING** - This will delete 100 messages in this channel! Are you sure? **(y/n)**");
    numberMessages = 97;
  }
  if (!pieces[1]) {
    //Disable recursion for a while - causing bulk delete errors.
    //message.channel.send("**WARNING** - This will delete all messages in this channel! Are you sure? **(y/n)**");
    //numberMessages = 97;
    //recurse = true;
    return message.channel.send("You can only use a number to delete messages. i.e. `!clean 10`")
  }
  const collector = message.channel.createMessageCollector((m) => message.author.id === m.author.id, {
    time: 30000
  });
  collector.on("collect", (m) => {
    if (m.content.toLowerCase() === "y" || m.content.toLowerCase() === "yes") {
      clean(message.channel, numberMessages + 3, recurse);
    } else {
      message.channel.send("Okay, I won't do that.");
      clean(message.channel, 4, false);
    }
    return collector.stop();
  });
  collector.on("end", (collected, reason) => {
    if (reason === "time") {
      message.channel.send("Command response timeout");
      clean(message.channel, 3, 0);
    }
  });
}

function createDayMap(message) {
  let dayMap = [];
  let d = new Date();
  let nd = helpers.convertDate(d, message.guild.id);
  dayMap[0] = new Date(String(nd));
  for (let i = 1; i < 7; i++) {
    dayMap[i] = new Date(nd.setDate(nd.getDate() + 1));
  }
  return dayMap;
}

function checkDateMatch(date1, date2) {
  return moment(date1).isSame(date2, "day");
}

function getEvents(message, calendarID, dayMap) {
  try {
    let tempDayArray = {
      "day0": [],
      "day1": [],
      "day2": [],
      "day3": [],
      "day4": [],
      "day5": [],
      "day6": []
    };
    let tempKey;
    let calendarPath = path.join(__dirname, "..", "stores", message.guild.id, "calendar.json");
    let calendar = helpers.readFile(calendarPath);
    let guildSettingsPath = path.join(__dirname, "..", "stores", message.guild.id, "settings.json");
    let guildSettings = helpers.readFile(guildSettingsPath);
    let events = [];
    let tz = guildSettings.timezone;
    let startDate = helpers.stringDate(dayMap[0], message.guild.id, "start");
    let endDate = helpers.stringDate(dayMap[6], message.guild.id, "end");
    let params = {
      timeMin: startDate,
      timeMax: endDate,
      singleEvents: true,
      orderBy: "startTime"
    };
    cal.Events.list(calendarID, params).then((json) => {
      for (let i = 0; i < json.length; i++) {
        let event = {
          id: json[i].id,
          summary: json[i].summary,
          start: json[i].start,
          end: json[i].end
        };
        events.push(event);
      }
      for (let day = 0; day < 7; day++) {
        let key = "day" + String(day);
        let matches = [];
        for (let j = 0; j < json.length; j++) {
          let tempDate = new Date(events[j].start.dateTime);
          tempDate = helpers.convertDate(tempDate, message.guild.id);
          if (checkDateMatch(dayMap[day], tempDate)) {
            matches.push(events[j]);
          }
          //Handle All Day Events
          if (events[j].start.date) {
            let tempStartDate = new Date(events[j].start.date);
            let tempEndDate = new Date(events[j].end.date);
            let lengthEvent = ((tempEndDate.getTime() - tempStartDate.getTime()) / (1000 * 60 * 60 * 24));
            let allDayEvent = new Date(events[j].start.date);
            if (checkDateMatch(dayMap[day], allDayEvent)) {
              matches.push(events[j]);
              for (let x = 1; x < lengthEvent; x++) { //Add New Entry For Each Day of A Multi Day Event
                let newDateTime = (tempStartDate.getTime()) + (x * 24 * 60 * 60 * 1000);
                let newDateA = new Date(newDateTime);
                let newDateString = (helpers.convertDate(newDateA, message.guild.id)).toJSON().slice(0, 10);
                let newEvent = {
                  id: events[j].id,
                  summary: events[j].summary,
                  start: {
                    "date": newDateString
                  },
                  end: events[j].end
                };
                tempKey = "day" + String(day + x);
                tempDayArray[tempKey] = newEvent;
              }
            }
          }
        }
        calendar[key] = matches;
        if (tempDayArray[key].id) {
          calendar[key].push({
            "id": tempDayArray[key].id,
            "summary": tempDayArray[key].summary,
            "start": tempDayArray[key].start,
            "end": tempDayArray[key].end
          });
        }

      }
      let d = new Date();
      calendar.lastUpdate = d;
      helpers.writeGuildSpecific(message.guild.id, calendar, "calendar");
    }).catch((err) => {
      if (err.message.includes("notFound")) {
        helpers.log("function getEvents error in guild: " + message.guild.id + " : 404 error can't find calendar");
        message.channel.send(strings.NO_CALENDAR_MESSAGE);
        clearInterval(autoUpdater[message.guild.id]);
        try {
          delete timerCount[message.guild.id];
          message.channel.send("update timer has been killed.");
        } catch (err) {
          helpers.log(err);
        }
        return;
      }
      //Catching periodic google rejections;
      if (err.message.includes("Invalid Credentials")) {
        return helpers.log("function getEvents error in guild: " + message.guild.id + " : 401 invalid credentials");
      } else {
        helpers.log("function getEvents error in guild: " + message.guild.id + " : " + err);
        clearInterval(autoUpdater[message.guild.id]);
      }
    });
  } catch (err) {
    message.channel.send(err.code);
    return helpers.log("Error in function getEvents in guild: " + message.guild.id + " : " + err);
  }
}

function generateCalendar(message, dayMap) {
  let calendarPath = path.join(__dirname, "..", "stores", message.guild.id, "calendar.json");
  let calendar = helpers.readFile(calendarPath);
  let guildSettingsPath = path.join(__dirname, "..", "stores", message.guild.id, "settings.json");
  let guildSettings = helpers.readFile(guildSettingsPath);
  let format = guildSettings.format;
  let p = defer();
  let finalString = "";
  for (let i = 0; i < 7; i++) {
    let key = "day" + String(i);
    let sendString = "";
    sendString += "\n" + moment(dayMap[i]).format("**dddd** - MMMM D\n");
    if (calendar[key].length === 0) {
      sendString += "``` ```";
    } else {
      sendString += "```";
      // Map events for each day
      for (let m = 0; m < calendar[key].length; m++) {
        let options = {
          showHeaders: false,
          columnSplitter: " | ",
          columns: ["time", "events"],
          config: {
            time: {
              minWidth: 17,
              align: "center"
            },
            events: {
              minWidth: 30
            }
          }
        };
        if (Object.keys(calendar[key][m].start).includes("date")) {
          let tempString = {};
          let tempStartDate = moment(calendar[key][m].start.date);
          tempStartDate = helpers.convertDate(tempStartDate, message.guild.id);
          let tempFinDate = moment(calendar[key][m].end.date);
          tempFinDate = helpers.convertDate(tempFinDate, message.guild.id);
          tempString["All Day"] = calendar[key][m].summary;
          sendString += columnify(tempString, options) + "\n";
        } else if (Object.keys(calendar[key][m].start).includes("dateTime")) {
          let tempString = {};
          let tempStartDate = moment(calendar[key][m].start.dateTime);
          tempStartDate = helpers.convertDate(tempStartDate, message.guild.id);
          let tempFinDate = moment(calendar[key][m].end.dateTime);
          tempFinDate = helpers.convertDate(tempFinDate, message.guild.id);
          tempString[helpers.getStringTime(tempStartDate,format) + " - " + helpers.getStringTime(tempFinDate,format)] = calendar[key][m].summary;
          sendString += columnify(tempString, options) + "\n";
        }
      }
      sendString += "```";
    }
    finalString += sendString;
    //Handle Calendars Greater Than 2048 Characters Long
    if (finalString.length>2048) {
      message.channel.send("Your total calendar length exceeds 2048 characters - this is a Discord limitation - Try reducing the length of your event names or total number of events");
      p.reject(2048);
      return p.promise;
    }
  }
  let embed = new bot.discord.MessageEmbed();
  embed.setTitle("CALENDAR");
  embed.setURL("https://calendar.google.com/calendar/embed?src=" + guildSettings.calendarID);
  embed.setColor("BLUE");
  embed.setDescription(finalString);
  embed.setFooter("Last update");
  if (guildSettings.helpmenu === "1") {
    embed.addField("USING THIS CALENDAR", "To create events use ``!create`` or ``!scrim`` followed by your event details i.e. ``!scrim xeno on monday at 8pm-10pm``\n\nTo delete events use``!delete <day> <start time>`` i.e. ``!delete monday 5pm``\n\nHide this message using ``!displayoptions help 0``\n\nEnter ``!help`` for a full list of commands.", false);
  }
  if (guildSettings.tzDisplay === "1") { // display timezone
    embed.addField("Timezone", guildSettings.timezone, false);
  }
  embed.setTimestamp(new Date());
  p.resolve(embed);
  return p.promise;
}

function startUpdateTimer(message) {
  if (!timerCount[message.guild.id]) {
    timerCount[message.guild.id] = 0;
  }
  let guildSettingsPath = path.join(__dirname, "..", "stores", message.guild.id, "settings.json");
  let guildSettings = helpers.readFile(guildSettingsPath);
  let calendarID = guildSettings.calendarID;
  let dayMap = createDayMap(message);
  //Pull updates on set interval
  if (!autoUpdater[message.guild.id]) {
    timerCount[message.guild.id] += 1;
    helpers.log("Starting update timer in guild: " + message.guild.id);
    return autoUpdater[message.guild.id] = setInterval(function func() {
      calendarUpdater(message, calendarID, dayMap, timerCount[message.guild.id]);
    }, settings.secrets.calendar_update_interval);

  }
  if (autoUpdater[message.guild.id]._idleTimeout !== settings.secrets.calendar_update_interval) {
    try {
      timerCount[message.guild.id] += 1;
      helpers.log("Starting update timer in guild: " + message.guild.id);
      return autoUpdater[message.guild.id] = setInterval(function func() {
        calendarUpdater(message, calendarID, dayMap, timerCount[message.guild.id]);
      }, settings.secrets.calendar_update_interval);
    } catch (err) {
      helpers.log("error starting the autoupdater" + err);
      clearInterval(autoUpdater[message.guild.id]);
      delete timerCount[message.guild.id];
    }
  } else {
    return helpers.log("timer not started in guild: " + message.guild.id);
  }
}

function postCalendar(message, dayMap) {
  try {
    let calendarPath = path.join(__dirname, "..", "stores", message.guild.id, "calendar.json");
    let calendar = helpers.readFile(calendarPath);
    let guildSettingsPath = path.join(__dirname, "..", "stores", message.guild.id, "settings.json");
    let guildSettings = helpers.readFile(guildSettingsPath);

    if (calendar.calendarMessageId) {
      message.channel.messages.fetch(calendar.calendarMessageId).then((message) => {
        message.delete();
      }).catch((err) => {
        if (err.code === 10008) {
          calendar.calendarMessageId = "";
          helpers.writeGuildSpecific(message.guild.id, calendar, "calendar");
          return helpers.log("error fetching previous calendar in guild: " + message.guild.id + ":" + err);
        } else {
          return helpers.log("error fetching previous calendar in guild: " + message.guild.id + ":" + err);
        }
      });
    }
    generateCalendar(message, dayMap).then((embed) => {
      if (embed === 2048) {
        return
      }
      message.channel.send({
        embed
      }).then((sent) => {
        calendar.calendarMessageId = sent.id;
        if (guildSettings.pin === "1" || guildSettings.pin == null) {
          sent.pin();
        }
      });
    }).then((confirm) => {
      setTimeout(function func() {
        helpers.writeGuildSpecific(message.guild.id, calendar, "calendar");
        setTimeout(function func() {
          startUpdateTimer(message);
        }, 2000);
      }, 2000);
    }).catch((err) => {
      if(err===2048) {
          helpers.log("funtion postCalendar error in guild: " + message.guild.id + ": " + err + " - Calendar too long");
        } else {
          helpers.log("funtion postCalendar error in guild: " + message.guild.id + ": " + err);
        }
    });
  } catch (err) {
    message.channel.send(err.code);
    return helpers.log("Error in post calendar in guild: " + message.guild.id + " : " + err);
  }
}

function updateCalendar(message, dayMap, human) {
  let guildSettingsPath = path.join(__dirname, "..", "stores", message.guild.id, "settings.json");
  let guildSettings = helpers.readFile(guildSettingsPath);
  let calendarPath = path.join(__dirname, "..", "stores", message.guild.id, "calendar.json");
  let calendar = helpers.readFile(calendarPath);
  if (typeof calendar === "undefined") {
    helpers.log("calendar undefined in " + message.guild.id + ". Killing update timer.");
    clearInterval(autoUpdater[message.guild.id]);
    try {
      delete timerCount[message.guild.id];
      message.channel.send("update timer has been killed.");
    } catch (err) {
      helpers.log(err);
    }
    return;
  }
  if (calendar.calendarMessageId === "") {
    clearInterval(autoUpdater[message.guild.id]);
    try {
      delete timerCount[message.guild.id];
      message.channel.send("update timer has been killed.");
    } catch (err) {
      helpers.log(err);
    }
    message.channel.send("I can't find the last calendar I posted. Use `!display` and I'll post a new one.").then((m) => {});
    return;
  }
  let messageId = calendar.calendarMessageId;
  message.channel.messages.fetch(messageId).then((m) => {
    generateCalendar(message, dayMap).then((embed) => {
      if (embed === 2048) {
        return
      }
      m.edit({
        embed
      });
      if ((timerCount[message.guild.id] === 0 || !timerCount[message.guild.id]) && human) {
        startUpdateTimer(message);
      }
    });
  }).catch((err) => {
    helpers.log("error fetching previous calendar message in guild: " + message.guild.id + ": " + err);
    //If theres an updater running try and kill it.
    try {
      clearInterval(autoUpdater[message.guild.id]);
      try {
        delete timerCount[message.guild.id];
        message.channel.send("update timer has been killed.");
      } catch (err) {
        helpers.log(err);
      }
    } catch (err) {
      helpers.log(err);
    }
    message.channel.send("I can't find the last calendar I posted. Use `!display` and I'll post a new one.");
    calendar.calendarMessageId = "";
    helpers.writeGuildSpecific(message.guild.id, calendar, "calendar");
    return;
  });
}

function quickAddEvent(message, calendarId) {
  let p = defer();
  let pieces = message.content.split(" ");
  if (!pieces[1]) {
    return message.channel.send("You need to enter an argument for this command. i.e `!scrim xeno thursday 8pm - 9pm`")
      .then((m) => {
        m.delete({ timeout: 5000 });
      });
  }
  let text = "";
  for (let i = 1; i < pieces.length; i++) {
    text += pieces[i] + " ";
  }
  let params = {
    text
  };
  cal.Events.quickAdd(calendarId, params).then((resp) => {
    let json = resp;
    let promptDate;
    if (resp.start.dateTime) {promptDate=resp.start.dateTime;} else {promptDate=resp.start.date}
    message.channel.send("Event `" + resp.summary + "` on `" + promptDate + "` has been created").then((m) => {
      m.delete({ timeout: 5000 });
    });
    p.resolve(resp);
  }).catch((err) => {
    helpers.log("function updateCalendar error in guild: " + message.guild.id + ": " + err);
    p.reject(err);
  });
  return p.promise;
}

function displayOptions(message) {
  let pieces = message.content.split(" ");
  let guildSettingsPath = path.join(__dirname, "..", "stores", message.guild.id, "settings.json");
  let guildSettings = helpers.readFile(guildSettingsPath);
  if (pieces[1] === "help") {
    if (pieces[2] === "1") {
      guildSettings.helpmenu = "1";
      helpers.writeGuildSpecific(message.guild.id, guildSettings, "settings");
      message.channel.send("Okay I've turned the calendar help menu on");
    } else if (pieces[2] === "0") {
      guildSettings.helpmenu = "0";
      helpers.writeGuildSpecific(message.guild.id, guildSettings, "settings");
      message.channel.send("Okay I've turned the calendar help menu off");
    } else {
      message.channel.send("Please only use 0 or 1 for the calendar help menu options, (off or on)");
    }
  } else if (pieces[1] === "pin") {
    if (pieces[2] === "1") {
      guildSettings.pin = "1";
      helpers.writeGuildSpecific(message.guild.id, guildSettings, "settings");
      message.channel.send("Okay I've turned pinning on");
    } else if (pieces[2] === "0") {
      guildSettings.pin = "0";
      helpers.writeGuildSpecific(message.guild.id, guildSettings, "settings");
      message.channel.send("Okay I've turned pinning off");
    } else {
      message.channel.send("Please only use 0 or 1 for the calendar help menu options, (off or on)");
    }
  } else if (pieces[1] === "format") {
    if (pieces[2] === "12") {
      guildSettings.format = 12;
      helpers.writeGuildSpecific(message.guild.id, guildSettings, "settings");
      message.channel.send("Set to 12-Hour clock format");
    } else if (pieces[2] === "24") {
      guildSettings.format = 24;
      helpers.writeGuildSpecific(message.guild.id, guildSettings, "settings");
      message.channel.send("Set to 24-Hour clock format");
    } else {
      message.channel.send("Please only use 12 or 24 for the clock display options");
    }
  } else if (pieces[1] === "tzdisplay") {
    if (pieces[2] === "1") {
      guildSettings.tzDisplay = "1";
      helpers.writeGuildSpecific(message.guild.id, guildSettings, "settings");
      message.channel.send("Turned timezone display on");
    } else if (pieces[2] === "0") {
      guildSettings.tzDisplay = "0";
      helpers.writeGuildSpecific(message.guild.id, guildSettings, "settings");
      message.channel.send("Turned timezone display off");
    } else {
      message.channel.send("Please only use 0 or 1 for the calendar timzone display options, (off or on)");
    }
  } else if (pieces[1] == null) {
    message.channel.send("`!displayoptions help`, `!displayoptions pin`, `!displayoptions format`, `!displayoptions tzdisplay` are the only valid Display Options.");
  }
  else {
    message.channel.send("I don't think thats a valid display option, sorry!");
  }
}

function deleteEventById(eventId, calendarId, dayMap, message) {
  let params = {
    sendNotifications: true
  };
  return cal.Events.delete(calendarId, eventId, params).then((resp) => {
    getEvents(message, calendarId, dayMap);
    setTimeout(function func() {
      updateCalendar(message, dayMap, true);
    }, 2000);
  }).catch((err) => {
    helpers.log("function deleteEventById error in guild: " + message.guild.id + ": " + err);
  });
}

function listSingleEventsWithinDateRange(message, calendarId, dayMap) {
  let calendarPath = path.join(__dirname, "..", "stores", message.guild.id, "calendar.json");
  let calendar = helpers.readFile(calendarPath);
  let guildSettingsPath = path.join(__dirname, "..", "stores", message.guild.id, "settings.json");
  let guildSettings = helpers.readFile(guildSettingsPath);
	let eventsArray = [];
  let tz = guildSettings.timezone;
  let startDate = helpers.stringDate(dayMap[0], message.guild.id, "start");
  let endDate = helpers.stringDate(dayMap[6], message.guild.id, "end");
  let params = {
    timeMin: startDate,
    timeMax: endDate,
    singleEvents: true
  };
	return cal.Events.list(calendarId, params)
		.then(json => {
			for (let i = 0; i < json.length; i++) {
				let event = {
					id: json[i].id,
					summary: json[i].summary,
					location: json[i].location,
					start: json[i].start,
					end: json[i].end,
					status: json[i].status
				};
				eventsArray.push(event);
			}
			return eventsArray;
		}).catch(err => {
			helpers.log('Error: listSingleEventsWithinDateRange', err.message);
		});
}

function deleteEvent(message, calendarId, dayMap) {
  let deleteMessages = [];
  let startTime;
  let endTime;
  let pieces = message.content.split(" ");
  if (!pieces[1]) {
    return message.channel.send("You need to enter an argument for this command. i.e `!scrim xeno thursday 8pm - 9pm`")
      .then((m) => {
        m.delete({ timeout: 5000 });
      });
  }
  let text = "";
  for (let i = 1; i < pieces.length; i++) {
    text += pieces[i] + " ";
  }
  listSingleEventsWithinDateRange(message, calendarId, dayMap).then((resp) => {
    for (let i = 0; i < resp.length; i++) {
      if (resp[i].summary) {
        if (text.toUpperCase().trim() == resp[i].summary.toUpperCase().trim()) {
          let promptDate;
          if (resp[i].start.dateTime) {promptDate=resp[i].start.dateTime;} else {promptDate=resp[i].start.date}
          message.channel.send(`Are you sure you want to delete the event **${resp[i].summary}** on ${promptDate}? **(y/n)**`)
            .then((res) => {
              res.delete({ timeout: 10000 });
            });
          const collector = message.channel.createMessageCollector((m) => message.author.id === m.author.id, {
            time: 10000
          });
          collector.on("collect", (m) => {
            deleteMessages.push(m.id);
            if (m.content.toLowerCase() === "y" || m.content.toLowerCase() === "yes") {
              deleteEventById(resp[i].id, calendarId, dayMap, message).then((del) => {
                message.channel.send(`Event **${resp[i].summary}** deleted`).then((res) => {
                  res.delete({ timeout: 10000 });
                });
              });
            } else {
              message.channel.send("Okay, I won't do that").then((res) => {
                res.delete({ timeout: 5000 });
              });
            }
            for (let k = 0; k < deleteMessages.length; k++) {
              message.channel.messages.fetch(deleteMessages[k]).then((m) => {
                m.delete({ timeout: 5000 });
              });
            }
            return collector.stop();
          });
          collector.on("end", (collected, reason) => {
            if (reason === "time") {
              message.channel.send("command response timeout").then((res) => {
                res.delete({ timeout: 5000 });
              });
            }
          });
          return;
        }
      }
    }
    return message.channel.send("Couldn't find event with that name - make sure you use exactly what the event is named!").then((res) => {
      res.delete({ timeout: 5000 })});
  }).catch((err) => {
    helpers.log(err); //FIX THIS
    return message.channel.send("There was an error finding this event").then((res) => {
      res.delete({ timeout: 5000 })});
  });
}

function calendarUpdater(message, calendarId, dayMap, timerCount) {
  try {
    dayMap = createDayMap(message);
    setTimeout(function func() {
      getEvents(message, calendarId, dayMap);
    }, 2000);
    setTimeout(function func() {
      updateCalendar(message, dayMap, false);
    }, 4000);
  } catch (err) {
    helpers.log("error in autoupdater in guild: " + message.guild.id + ": " + err);
    clearInterval(autoUpdater[message.guild.id]);
    try {
      delete timerCount[message.guild.id];
      //message.channel.send("update timer has been killed.");
    } catch (err) {
      helpers.log(err);
    }
  }
}

function displayStats(message) {
  let embed = new bot.discord.MessageEmbed()
    .setColor("RED")
    .setTitle(`Niles Bot ${settings.secrets.current_version}`)
    .setURL("https://github.com/seanecoffey/Niles")
    .addField("Servers", bot.client.guilds.cache.size, true)
    .addField("Uptime", moment.duration(process.uptime(), "seconds").format("dd:hh:mm:ss"), true)
    .addField("Ping", `${(bot.client.ws.ping).toFixed(0)} ms`, true)
    .addField("RAM Usage", `${(process.memoryUsage().rss / 1048576).toFixed()}MB/${(os.totalmem() > 1073741824 ? (os.totalmem() / 1073741824).toFixed(1) + " GB" : (os.totalmem() / 1048576).toFixed() + " MB")}
      (${(process.memoryUsage().rss / os.totalmem() * 100).toFixed(2)}%)`, true)
    .addField("System Info", `${process.platform} (${process.arch})\n${(os.totalmem() > 1073741824 ? (os.totalmem() / 1073741824).toFixed(1) + " GB" : (os.totalmem() / 1048576).toFixed(2) + " MB")}`, true)
    .addField("Libraries", `[Discord.js](https://discord.js.org) v${bot.discord.version}\nNode.js ${process.version}`, true)
    .addField("Links", "[Bot invite](https://discord.com/oauth2/authorize?permissions=97344&scope=bot&client_id=" + bot.client.user.id + ") | [Support server invite](https://discord.gg/jNyntBn) | [GitHub](https://github.com/seanecoffey/Niles)", true)
    .setFooter("Created by Sean#0420");
  message.channel.send({
    embed
  }).catch((err) => {
    helpers.log(err);
  });
}

exports.deleteUpdater = function(guildid) {
  clearInterval(autoUpdater[guildid]);
  try {
    delete timerCount[guildid];
  } catch (err) {
    helpers.log(err);
  }
};

function delayGetEvents(message, calendarId, dayMap) {
  setTimeout(function func() {
    getEvents(message, calendarId, dayMap);
  }, 1000);
}

function run(message) {
  let guildSettingsPath = path.join(__dirname, "..", "stores", message.guild.id, "settings.json");
  let guildSettings = helpers.readFile(guildSettingsPath);
  let calendarID = guildSettings.calendarID;
  let calendarPath = path.join(__dirname, "..", "stores", message.guild.id, "calendar.json");
  let calendar = helpers.readFile(calendarPath);
  let dayMap = createDayMap(message);
  const cmd = message.content.toLowerCase().substring(guildSettings.prefix.length).split(" ")[0];
  
  if (cmd === "cold") {
	  message.channel.send(":cold_face: :wave:");
  }
  
  if (cmd === "apples") {
	  message.channel.send(":apple: :wave:");
  }
  
  if (cmd === "vision") {
	  message.channel.send(":eyes: :wave:");
  }
  
  if (cmd === "pyro") {
	  message.channel.send(":fire: :wave:");
  }
  
  if (cmd === "optimus") {
	  message.channel.send(":robot: :wave:");
  }
  
  if (cmd === "saar") {
	  message.channel.send("spam this :chocolate_bar: to wake up saar");
  }
  
  if (cmd === "rub") {
	  message.channel.send(":regional_indicator_r: :regional_indicator_u: :regional_indicator_b:  :wave:");
  }
  
  
  if (cmd === "ping" || helpers.mentioned(message, "ping")) {
    message.channel.send(`:ping_pong: !Pong! ${(bot.client.ws.ping).toFixed(0)}ms`).catch((err) => {
      helpers.sendMessageHandler(message, err);
    });
  }
  
  if (cmd === "help" || helpers.mentioned(message, "help")) {
    message.channel.send(strings.HELP_MESSAGE);
    message.delete({ timeout: 5000 });
  }
  if (cmd === "invite" || helpers.mentioned(message, "invite")) {
    message.channel.send({
      embed: new bot.discord.MessageEmbed()
        .setColor("#FFFFF")
        .setDescription("Click [here](https://discord.com/oauth2/authorize?permissions=97344&scope=bot&client_id=" + bot.client.user.id + ") to invite me to your server")
    }).catch((err) => {
      helpers.sendMessageHandler(message, err);
    });
    message.delete({ timeout: 5000 });
  }
  if (["setup", "start", "id", "tz", "prefix", "admin"].includes(cmd) || helpers.mentioned(message, ["setup", "start", "id", "tz", "prefix", "admin"])) {
    try {
      init.run(message);
    } catch (err) {
      helpers.log("error trying to run init message catcher in guild: " + message.guild.id + ": " + err);
    }
    message.delete({ timeout: 5000 });
  }
  if (cmd === "init" || helpers.mentioned(message, "init")) {
    guilds.create(message.guild);
    message.delete({ timeout: 5000 });
  }
  if (["clean", "purge"].includes(cmd) || helpers.mentioned(message, ["clean", "purge"])) {
    deleteMessages(message);
  }
  if (cmd === "display" || helpers.mentioned(message, "display")) {
    delayGetEvents(message, calendarID, dayMap);
    setTimeout(function func() {
      postCalendar(message, dayMap);
    }, 2000);
    message.delete({ timeout: 5000 });
  }
  if (cmd === "update" || helpers.mentioned(message, "update")) {
    if (typeof calendar === "undefined") {
      message.channel.send("Cannot find calendar to update, maybe try a new calendar with `!display`");
      helpers.log("calendar undefined in " + message.guild.id + ". Killing update timer.");
      clearInterval(autoUpdater[message.guild.id]);
      try {
        delete timerCount[message.guild.id];
        //message.channel.send("update timer has been killed.");
      } catch (err) {
        helpers.log(err);
      }
      return;
    }
    if (calendar.calendarMessageId === "") {
      message.channel.send("Cannot find calendar to update, maybe try a new calendar with `!display`");
      message.delete({ timeout: 5000 });
      return;
    }
    delayGetEvents(message, calendarID, dayMap);
    setTimeout(function func() {
      try {
        updateCalendar(message, dayMap, true);
      } catch (err) {
        helpers.log("error in update command: " + err);
      }
    }, 2000);
    message.delete({ timeout: 5000 });
  }
  if (["create", "scrim"].includes(cmd) || helpers.mentioned(message, ["create", "scrim"])) {
    quickAddEvent(message, calendarID).then((resp) => {
      getEvents(message, calendarID, dayMap);
    }).then((resp) => {
      setTimeout(function func() {
        updateCalendar(message, dayMap, true);
      }, 2000);
    }).catch((err) => {
      helpers.log("error creating event in guild: " + message.guild.id + ": " + err);
    });
    message.delete({ timeout: 5000 });
  }
  if (cmd === "displayoptions" || helpers.mentioned(message, "displayoptions")) {
    displayOptions(message);
    message.delete({ timeout: 5000 });
  }
  if (["stats", "info"].includes(cmd) || helpers.mentioned(message, ["stats", "info"])) {
    displayStats(message);
    message.delete({ timeout: 5000 });
  }
  if (cmd === "get" || helpers.mentioned(message, "get")) {
    getEvents(message, calendarID, dayMap);
    message.delete({ timeout: 5000 });
  }
  if (cmd === "stop" || helpers.mentioned(message, "stop")) {
    clearInterval(autoUpdater[message.guild.id]);
    delete timerCount[message.guild.id];
  }
  if (cmd === "delete" || helpers.mentioned(message, "delete")) {
    deleteEvent(message, calendarID, dayMap);
    message.delete({ timeout: 5000 });
  }
  if (cmd === "count" || helpers.mentioned(message, "count")) {
    let theCount;
    if (!timerCount[message.guild.id]) {
      theCount = 0;
    } else {
      theCount = timerCount[message.guild.id];
    }
    message.channel.send("There are " + theCount + " timer threads running in this guild");
  }
  if (cmd === "timers" || helpers.mentioned(message, "timers")) {
    if (message.author.id === settings.secrets.super_admin) {
      return message.channel.send("There are " + Object.keys(timerCount).length + " timers running across all guilds right now.");
    } else {
      return;
    }
  }
}

module.exports = {
  run
};
