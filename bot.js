let discord = import("discord.js");
let client = new discord.Client();
exports.discord = discord;
exports.client = client;
const path = import("path");
const users = import("./stores/users.json");
let settings = import("./settings.js");
let commands = import("./handlers/commands.js");
let guilds = import("./handlers/guilds.js");
let init = import("./handlers/init.js");
let helpers = import("./handlers/helpers.js");
let restricted = import("./handlers/nopermissions.js");
let dm = import("./handlers/dm.js");
let checks = import("./handlers/createMissingAttributes.js");

client.login(settings.secrets.bot_token);

client.on("ready", () => {
  helpers.log("Bot is logged in.");
  client.user.setStatus("online");

  //Create databases for any missing guilds
  const availableGuilds = Array.from(client.guilds.cache.keys());
  const knownGuilds = Object.keys(helpers.getGuildDatabase());
  const unknownGuilds = availableGuilds.filter(x => !knownGuilds.includes(x));

  unknownGuilds.forEach((guildId) => {
    helpers.log("unknown guild found; creating");
    guilds.create(client.guilds.cache.get(guildId));
  });
});

client.on("guildCreate", (guild) => {
  guilds.create(guild);
});

client.on("guildDelete", (guild) => {
  guilds.delete(guild);
});

client.on("message", (message) => {
  if (message.author.bot) {
    return;
  }
  if (message.channel.type === "dm") {
    try {
      dm.run(message);
    } catch (err) {
      helpers.log("error in dm channel" + err);
    }
    return;
  }
  //only load guild settings after checking that message is not direct message.
  let guildSettingsPath = path.join(__dirname, "stores", message.guild.id, "settings.json");
  try {
    var guildSettings = helpers.readFile(guildSettingsPath);
  } catch (err) {
    return helpers.log(err);
  }
  //Check that there is a prefix - need more robust check of database files.
  try {
    (guildSettings.prefix);
  } catch (err) {
    guilds.create(message.guild);
    message.channel.send("Sorry, I've had to re-create your database files, you'll have to run the setup process again :(");
    return helpers.log("settings file not created properly in guild: " + message.guild.id + ". Attempted re-creation");
  }
  //Check calendar file becoming corrupted.
  try {
    let calendarID = guildSettings.calendarID;
    let calendarPath = path.join(__dirname, "stores", message.guild.id, "calendar.json");
    let calendar = helpers.readFile(calendarPath);
    (calendar.day0);
  } catch (err) {
    guilds.create(message.guild);
    message.channel.send("Sorry, the database for this server had to be re-created, you'll have to run the setup process again :(");
    return helpers.log("calendar file not created properly in guild: " + message.guild.id + ". Attempted re-creation");
  }
  //Check if the database structure is up to date.
  try {
    if (checks.allowedRoles(message)) {
      return message.channel.send("Sorry, I just had to update your database files. Please try again.");
    }
  } catch (err) {
    return helpers.log(err);
  }
  //Ignore messages that dont use guild prefix or mentions.
  if (!message.content.toLowerCase().startsWith(guildSettings.prefix) && !message.mentions.has(client.user.id)) {
    return;
  }
  //Ignore if the command isn't one of the commands.
  let cmd;
  if (message.content.toLowerCase().startsWith(guildSettings.prefix)) {
    cmd = message.content.toLowerCase().substring(guildSettings.prefix.length).split(" ")[0];
  } else if (message.mentions.has(client.user.id)) {
    cmd = message.content.toLowerCase().split(" ")[1];
  }
  if (!restricted.allCommands.includes(cmd)) {
    return;
  } else {
    helpers.log(`${helpers.fullname(message.author)}:${message.content} || guild:${message.guild.id}`);
  }
  if (!helpers.checkPermissions(message) && (!users[message.author.id] || users[message.author.id].permissionChecker === "1" || !users[message.author.id].permissionChecker)) {
    if (restricted.allCommands.includes(cmd)) {
      if (!helpers.checkRole(message)) {
        return message.channel.send("You must have the `" + guildSettings.allowedRoles[0] + "` role to use Niles in this server")
      }
      try {
        restricted.run(message);
      } catch (err) {
        helpers.log("error in restricted permissions " + err);
      }
      return;
    }
  } else if (!helpers.checkPermissions(message)) {
    return;
  }
  if (!guildSettings.calendarID || !guildSettings.timezone) {
    try {
      if (!helpers.checkRole(message)) {
        return message.channel.send("You must have the `" + guildSettings.allowedRoles[0] + "` role to use Niles in this server")
      }
      init.run(message);
    } catch (err) {
      helpers.log("error running init messages in guild: " + message.guild.id + ": " + err);
      return message.channel.send("I'm having issues with this server - please try kicking me and re-inviting me!");
    }
  } else {
    try {
      if (!helpers.checkRole(message)) {
        return message.channel.send("You must have the `" + guildSettings.allowedRoles[0] + "` role to use Niles in this server")
      }
      commands.run(message);
    } catch (err) {
      return helpers.log("error running main message handler in guild: " + message.guild.id + ": " + err);
    }
  }
});

// ProcessListeners
process.on("uncaughtException", (err) => {
  helpers.log("uncaughtException error" + err);
  process.exit();
});

process.on("SIGINT", () => {
  client.destroy();
  process.exit();
});

process.on("exit", () => {
  client.destroy();
  process.exit();
});

process.on("unhandledRejection", (err) => {
  helpers.log("Promise Rejection: " + err);
  // watch for ECONNRESET
  if (err.code === "ECONNRESET") {
    helpers.log("Connection Lost, Signalling restart");
    process.exit();
  }
});
