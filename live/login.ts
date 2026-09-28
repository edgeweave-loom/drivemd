import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { configDir, signIn } from "./grant.ts";

// Signs the test account in once, in the user's own terminal: it asks for the
// address the browser was sent back to, so it cannot run through `!`.

const lines = createInterface({ input: stdin, output: stdout });
try {
  await signIn(configDir(), process.env.DRIVEMD_LIVE_ACCOUNT, {
    show: (text) => stdout.write(text),
    ask: (question) => lines.question(question),
  });
} finally {
  lines.close();
}
