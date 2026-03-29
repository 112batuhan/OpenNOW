const minimist = require("minimist");

export function getArgument(argName: string) {
  const args = minimist(process.argv.slice(2), {
    default: {
      "profile-index": 1,
    },
  });

  return args[argName];
}

import { chromium, BrowserContext } from "playwright";
import path from "path";

const USERNAME: string = process.env.USERNAME || "USER";
const USER_DATA_DIR: string = `C:\\Users\\${USERNAME}\\AppData\\Local\\Google\\Chrome\\User Data`;

export async function runLoginScript(url: string) {
  const profileNumber = getArgument("profile-index");
  const profilePath = path.join(USER_DATA_DIR, `Profile ${profileNumber}`);

  console.log(`Launching Profile ${profileNumber}`);

  const context: BrowserContext = await chromium.launchPersistentContext(
    profilePath,
    {
      headless: false,
      viewport: null, // Essential for --start-maximized
      args: ["--start-maximized", "--no-sandbox", "--disable-setuid-sandbox"],
    },
  );

  const page = await context.newPage();
  await page.goto(url);
  await page.getByRole("button", { name: "Continue" }).click();
  
  const successMessage = page.locator("div", {
    hasText: "Login complete",
  });
  await successMessage.waitFor({ state: "visible", timeout: 30000 });
  await context.close();
}
