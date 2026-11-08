import { startStorageFixture } from "../helpers/storage-fixture";
const fixture = await startStorageFixture(
  Number(
    process.env.PLAYWRIGHT_STORAGE_PORT ??
      Number(process.env.PLAYWRIGHT_PORT ?? 3000) + 1,
  ),
);
console.log(`Synthetic Storage fixture ready at ${fixture.url}`);
