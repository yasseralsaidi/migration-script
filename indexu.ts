import { config } from "dotenv";
config();

import * as fs from "fs";
import * as z from "zod";
import clerkClient from "@clerk/clerk-sdk-node";
import ora, { Ora } from "ora";

const SECRET_KEY = process.env.CLERK_SECRET_KEY;
const DELAY = parseInt(process.env.DELAY_MS ?? `1000`); // 1 second
const RETRY_DELAY = parseInt(process.env.RETRY_DELAY_MS ?? `10000`); // 10 seconds

if (!SECRET_KEY) {
  throw new Error(
    "CLERK_SECRET_KEY is required. Please copy .env.example to .env and add your key."
  );
}

const userUpdateSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  emailAddress: z.array(z.string().email()).optional(),
  phoneNumber: z.string().optional(),
  username: z.string().optional(),
  publicMetadata: z.record(z.unknown()).optional(),
  privateMetadata: z.record(z.unknown()).optional(),
  unsafeMetadata: z.record(z.unknown()).optional(),
});

type UserUpdate = z.infer<typeof userUpdateSchema>;

const updateUser = async (userId: string, userData: UserUpdate) => {
  return clerkClient.users.updateUser(userId, userData);
};

const now = new Date().toISOString().split(".")[0]; // YYYY-MM-DDTHH:mm:ss
function appendLog(payload: any) {
  fs.appendFileSync(
    `./update-log-${now}.json`,
    `\n${JSON.stringify(payload, null, 2)}`
  );
}

let updated = 0;
let failed = 0;

async function processUserUpdate(
  userId: string,
  userData: UserUpdate,
  spinner: Ora
) {
  const txt = spinner.text;
  try {
    const parsedUserData = userUpdateSchema.safeParse(userData);
    if (!parsedUserData.success) {
      throw parsedUserData.error;
    }
    await updateUser(userId, parsedUserData.data);
    updated++;
  } catch (error) {
    if (error.status === 429) {
      spinner.text = `${txt} - rate limit reached, waiting for ${RETRY_DELAY} ms`;
      await rateLimitCooldown();
      spinner.text = txt;
      return processUserUpdate(userId, userData, spinner);
    }

    appendLog({ userId, ...error });
    failed++;
  }
}

async function cooldown() {
  await new Promise((r) => setTimeout(r, DELAY));
}

async function rateLimitCooldown() {
  await new Promise((r) => setTimeout(r, RETRY_DELAY));
}

async function updateUsers(updateData: UserUpdate, specificUserId?: string) {
  console.log(`Clerk User Update Utility`);

  const spinner = ora(`Updating users`).start();

  if (specificUserId) {
    spinner.text = `Updating user ${specificUserId}`;
    await processUserUpdate(specificUserId, updateData, spinner);
  } else {
    let lastId: string | null = null;
    const batchSize = 200;

    while (true) {
      const users = await clerkClient.users.getUserList({
        limit: batchSize,
        userId: lastId ? [">", lastId] : undefined,
      });

      if (users.length === 0) {
        break;
      }

      for (const user of users) {
        spinner.text = `Updating user ${user.id}`;
        const updateDataWithUsername = {
          ...updateData,
          username: user.username?.replace(/^[sc]/, "u"),
        };
        await processUserUpdate(user.id, updateDataWithUsername, spinner);
        await cooldown();
        lastId = user.id;
      }
    }
  }

  spinner.succeed(`Update process complete`);
}

async function main() {
  // Example update data
  const updateData: UserUpdate = {
    // other fields can be added here if needed
  };

  // To update a specific user, uncomment the following line and replace with the user's ID
  // await updateUsers(updateData, "user_specific_id");

  // To update all users, use:
  await updateUsers(updateData);

  console.log(`${updated} users updated`);
  console.log(`${failed} users failed to update`);
}

main().catch(console.error);
