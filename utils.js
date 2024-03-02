
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
  

module.exports = {
    proper, stripANSI,
    colors, avatars, cdn,
}