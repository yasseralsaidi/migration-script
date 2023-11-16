import { config } from "dotenv";
config();

import * as fs from "fs";
import * as z from "zod";
import clerkClient from "@clerk/clerk-sdk-node";

const retryDelay = 10_000; // 10 seconds
const secretKey = process.env.CLERK_SECRET_KEY;
if (!secretKey) {
  throw new Error("CLERK_SECRET_KEY is required");
}

const userSchema = z.object({
  userId: z.string(),
  email: z.string().email(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  password: z.string().optional(),
  passwordHasher: z
    .enum([
      "argon2i",
      "argon2id",
      "bcrypt",
      "md5",
      "pbkdf2_sha256",
      "pbkdf2_sha256_django",
      "pbkdf2_sha1",
      "scrypt_firebase",
    ])
    .optional(),
});

type User = z.infer<typeof userSchema>;

const errors: any[] = [];

const attemptCreateUser = (userData: User) =>
  userData.password
    ? clerkClient.users.createUser({
        externalId: userData.userId,
        emailAddress: [userData.email],
        firstName: userData.firstName,
        lastName: userData.lastName,
        passwordDigest: userData.password,
        passwordHasher: userData.passwordHasher,
      })
    : clerkClient.users.createUser({
        externalId: userData.userId,
        emailAddress: [userData.email],
        firstName: userData.firstName,
        lastName: userData.lastName,
        skipPasswordRequirement: true,
      });

let migrated = 0;
let alreadyExists = 0;

// Read the user data from the JSON file
const getUserData = async () =>
  userSchema
    .array()
    .parse(JSON.parse(await fs.promises.readFile("users.json", "utf-8")));

async function createUser(userData: User) {
  try {
    await attemptCreateUser(userData);

    migrated++;
  } catch (error) {
    if (error.status === 422) {
      console.log(`User already exits`);
      alreadyExists++;
      return;
    }

    if (error.status === 429) {
      console.log(`Waiting for rate limit to reset`);
      await new Promise((r) => setTimeout(r, retryDelay));

      console.log("Retrying");
      return createUser(userData);
    }

    errors.push(error);
    console.error("Error creating user:", error);
  }
}

async function createUsers() {
  console.log("Validating user data...");
  const validatedUserData = await getUserData();

  console.log("Migrating users");

  for (let i = 0; i < validatedUserData.length; i++) {
    await createUser(validatedUserData[i]);
  }

  await fs.promises.writeFile("errors.json", JSON.stringify(errors, null, 2));

  return validatedUserData;
}

console.log(`Clerk User Migration Utility`);

console.log(`Migrating users...`);

createUsers().then(() => {
  console.log(`${migrated} users migrated`);
  console.log(`${alreadyExists} users already exist`);
});
