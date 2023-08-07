'use strict';

const { fetch } = require("@elara-services/fetch");
const sdk = new (require("@elara-services/sdk").SDK)();
const pm2 = require("pm2");
const pmx = require("pmx");

function stripANSI(str) {
  const pattern = [
    '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
    '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))'
  ].join('|');
  const regex = new RegExp(pattern, "g");
  return str.replace(regex, '');
}
/**
 * @param {string} str 
 * @returns {string}
 */
function proper(name, splitBy) {
  if (name.startsWith("us-")) {
    const split = name.split("-")[1];
    return `US ${split.slice(0, 1).toUpperCase() + `${split.slice(1, split.length).toLowerCase()}`}`;
  }
  const str = `${name.slice(0, 1).toUpperCase()}${name.slice(1, name.length).toLowerCase()}`,
    by = (n) =>
      str
        .split(n)
        .map((c) => `${c.slice(0, 1).toUpperCase()}${c.slice(1, c.length).toLowerCase()}`)
        .join(" ");
  if (str.includes("_")) {
    return by("_");
  }
  if (str.includes(".")) {
    return by(".");
  }
  if (splitBy && str.includes(splitBy)) {
    return by(splitBy);
  }
  return str;
}

// Get the configuration from PM2
const conf = pmx.initModule();

// initialize buffer and queue_max opts
// buffer seconds can be between 1 and 5
conf.buffer_seconds = (conf.buffer_seconds > 0 && conf.buffer_seconds < 5) ? conf.buffer_seconds : 1;

// queue max can be between 10 and 100
conf.queue_max = (conf.queue_max > 10 && conf.queue_max <= 100) ? conf.queue_max : 100;

// create the message queue
let messages = [];

// create the suppressed object for sending suppression messages
let suppressed = {
  isSuppressed: false,
  date: new Date().getTime()
};
const colors = {
  log: 0x64acf3,
  error: 0xFF0000,
  exception: 0xFF0000,
  kill: 0xFF0000,
  suppressed: 0x64acf3
}
const cdn = (id, ending = "png") => `https://cdn.discordapp.com/emojis/${id}.${ending}`;
const avatars = {
  log: cdn(`313956277808005120`),
  error: cdn(`313956276893646850`),
  kill: cdn(`313956277237710868`),
  suppressed: cdn(`313956277237710868`),
  exception: cdn(`873444550692192337`)
}

/**
 * Function to send events to the Discord Webhook.
 * @param {object} message 
 * @param {string} message.name
 * @param {string} message.event
 * @param {string} message.description
 * @param {number} [message.timestamp]
 */
async function sendToDiscord(message) {

  // If a Discord URL is not set, we do not want to continue and nofify the user that it needs to be set
  if (!conf.discord_url) {
    return;
  }

  const isOver = message.description.length > 4000 ? true : false;
  let description;
  if (isOver) {
    const paste = await sdk.haste.post(message.description, { extension: "js" });
    if (paste.status) {
      description = paste.url;
    } else {
      description = `[OUTPUT]: Too large to display.`;
    }
  } else {
    description = `\`\`\`js\n${message.description}\`\`\``;
  }

  return await fetch(conf.discord_url, "POST")
    .query("wait", true)
    .body({
      username: `[${proper(message.event)}]: ${message.name}`,
      avatar_url: avatars[message.event] || "",
      embeds: [
        {
          author: { name: `PM2 Logs`, icon_url: `https://cdn.discordapp.com/emojis/815679520296271943.png` },
          title: proper(message.event),
          description,
          color: colors[message.event] || 0x64acf3,
          footer: { text: `Process: ${message.name}` }
        }
      ]
    }, "json")
    .send()
    .then((res) => {
      if (![200, 204].includes(res.statusCode)) {
        return console.error(`An error occured during the request for the Discord Webhook.`, res);
      }
    })
    .catch((err) => {
      if (err) {
        console.error(err);
      }
    });
}

// Function to get the next buffer of messages (buffer length = 1s)
function bufferMessage() {
  let nextMessage = messages.shift();

  if (!conf.buffer) {
    return nextMessage;
  }

  nextMessage.buffer = [nextMessage.description];

  // continue shifting elements off the queue while they are the same event and 
  // timestamp so they can be buffered together into a single request
  while (
    messages.length && (messages[0].timestamp >= nextMessage.timestamp &&
      messages[0].timestamp < (nextMessage.timestamp + conf.buffer_seconds)) &&
    messages[0].event === nextMessage.event
  ) {

    // append description to our buffer and shift the message off the queue and discard it
    nextMessage.buffer.push(messages[0].description);
    messages.shift();
  }

  // join the buffer with newlines
  nextMessage.description = nextMessage.buffer.join("\n");

  // delete the buffer from memory
  delete nextMessage.buffer;

  return nextMessage;
}

// Function to process the message queue
function processQueue() {

  // If we have a message in the message queue, removed it from the queue and send it to discord
  if (messages.length > 0) {
    sendToDiscord(bufferMessage());
  }

  // If there are over conf.queue_max messages in the queue, send the suppression message if it has not been sent and delete all the messages in the queue after this amount (default: 100)
  if (messages.length > conf.queue_max) {
    if (!suppressed.isSuppressed) {
      suppressed.isSuppressed = true;
      suppressed.date = new Date().getTime();
      sendToDiscord({
        name: 'pm2-discord',
        event: 'suppressed',
        description: 'Messages are being suppressed due to rate limiting.'
      });
    }
    messages.splice(conf.queue_max, messages.length);
  }

  // If the suppression message has been sent over 1 minute ago, we need to reset it back to false
  if (suppressed.isSuppressed && suppressed.date < (new Date().getTime() - 60000)) {
    suppressed.isSuppressed = false;
  }

  // Wait 10 seconds and then process the next message in the queue
  setTimeout(function () {
    processQueue();
  }, 10000);
}

function createMessage(data, eventName, altDescription) {
  // we don't want to output pm2-discord's logs
  if (data.process.name === 'pm2-discord') {
    return;
  }
  // if a specific process name was specified then we check to make sure only 
  // that process gets output
  if (conf.process_name !== null && data.process.name !== conf.process_name) {
    return;
  }

  let msg = altDescription || data.data;
  if (typeof msg === "object") {
    msg = JSON.stringify(msg);
  }

  messages.push({
    name: data.process.name,
    event: eventName,
    description: stripANSI(msg),
    timestamp: Math.floor(Date.now() / 1000),
  });
}

// Start listening on the PM2 BUS
pm2.launchBus(function (err, bus) {

  // Listen for process logs
  if (conf.log) {
    bus.on('log:out', function (data) {
      createMessage(data, 'log');
    });
  }

  // Listen for process errors
  if (conf.error) {
    bus.on('log:err', function (data) {
      createMessage(data, 'error');
    });
  }

  // Listen for PM2 kill
  if (conf.kill) {
    bus.on('pm2:kill', function (data) {
      messages.push({
        name: 'PM2',
        event: 'kill',
        description: data.msg,
        timestamp: Math.floor(Date.now() / 1000),
      });
    });
  }

  // Listen for process exceptions
  if (conf.exception) {
    bus.on('process:exception', function (data) {
      createMessage(data, 'exception');
    });
  }

  // Listen for PM2 events
  bus.on('process:event', function (data) {
    if (!conf[data.event]) {
      return;
    }
    createMessage(data, data.event, `The following event has occured on the PM2 process ${data.process.name}: ${data.event}`);
  });

  // Start the message processing
  processQueue();

});
