import { join } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import {
  codeFrom,
  configDir,
  finishLogin,
  readClient,
  saveGrant,
  startLogin,
} from "./grant.ts";

// Signs the test account in once, in the user's own terminal: it asks for the
// address the browser was sent back to, so it cannot run through `!`.

const account = process.env.DRIVEMD_LIVE_ACCOUNT;
if (account === undefined || account === "") {
  throw new Error("Set DRIVEMD_LIVE_ACCOUNT to the test account's address");
}
const dir = configDir();
const client = await readClient(dir);
if (!client) {
  throw new Error(
    `Save the desktop OAuth client as ${join(dir, "client.json")}, then chmod 600 it`,
  );
}

const { url, pending } = startLogin(client, account);
stdout.write(
  `Open this address, sign in as ${account} and allow access:\n\n${url}\n\n` +
    "The browser then fails to load 127.0.0.1: paste its address here.\n",
);
const lines = createInterface({ input: stdin, output: stdout });
const address = await lines.question("Address: ");
lines.close();

const grant = await finishLogin(
  client,
  account,
  codeFrom(address, pending),
  pending,
);
await saveGrant(dir, grant);
stdout.write(`Saved the grant for ${account} in ${dir}.\n`);
