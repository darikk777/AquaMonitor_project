import fs from "fs";
const modelJSON = JSON.parse(fs.readFileSync("teachable_machine/model.json", "utf8"));
console.log(modelJSON);