// Client for server.mjs. Usage: node drive.mjs <port> <command> [args...]
// Commands: shot [name] | list [all] | read | tree | click <n|text> | type <n|text> <text> | keys <text> | press <Key> [times]
//           focus | select <n|text> <option> | scroll down|up [px] | back | goto </path/> | viewport <w> <h> | reset | url | quit
const [port, cmd, ...args] = process.argv.slice(2);
if (!port || !cmd) { console.log("usage: node drive.mjs <port> <command> [args...]"); process.exit(1); }
const res = await fetch(`http://127.0.0.1:${port}/`, { method: "POST", body: JSON.stringify({ cmd, args }) }).catch((e) => ({ text: async () => `driver not reachable: ${e.message}` }));
console.log(await res.text());
