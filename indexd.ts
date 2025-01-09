import clerkClient from "@clerk/clerk-sdk-node";
import ora from "ora";

async function deleteUsers(
  limit: number = 200,
  batchSize: number = 50
): Promise<void> {
  let deletedCount = 0;
  let spinner;

  try {
    const totalUsers = await clerkClient.users.getCount();
    console.log(`Total users: ${totalUsers}`);

    spinner = ora("Deleting users...").start();

    while (true) {
      const users = await clerkClient.users.getUserList({ limit: batchSize });

      if (users.length === 0) {
        break;
      }

      for (const user of users) {
        try {
          await clerkClient.users.deleteUser(user.id);
          deletedCount++;

          if (deletedCount % 10 === 0) {
            spinner.text = `Deleted ${deletedCount} users...`;
          }

          if (deletedCount >= limit) {
            spinner.succeed(`Reached limit. Deleted ${deletedCount} users.`);
            return;
          }
        } catch (error) {
          console.error(`Failed to delete user ${user.id}:`, error);
        }
      }
    }

    spinner.succeed(`Successfully deleted ${deletedCount} users.`);
  } catch (error) {
    if (spinner) {
      spinner.fail("An error occurred during the deletion process.");
    }
    console.error("Error:", error);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const limit = args[0] ? parseInt(args[0], 10) : 200;
  const batchSize = args[1] ? parseInt(args[1], 10) : 50;

  console.log(
    `Starting user deletion process. Limit: ${limit}, Batch size: ${batchSize}`
  );
  await deleteUsers(limit, batchSize);
}

main().catch(console.error);
