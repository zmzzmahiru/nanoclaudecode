import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function confirm(message: string): Promise<boolean> {
  if (!input.isTTY) {
    console.log(`${message} y/N`);
    return false;
  }

  const readline = createInterface({ input, output });

  try {
    const answer = await readline.question(`${message} y/N `);
    return answer.trim().toLowerCase() === "y";
  } finally {
    readline.close();
  }
}
