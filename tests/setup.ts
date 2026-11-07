import dotenv from 'dotenv';
import path from 'path';

// Disable MD5 check for cached binary in test environment
process.env.MONGOMS_MD5_CHECK = 'false';

// Explicitly set test environment prior to loading .env or importing app
process.env.NODE_ENV = 'test';

// Explicitly load .env file from root
dotenv.config({ path: path.resolve(__dirname, '../.env') });
// Ensure NODE_ENV remains test even if .env defines NODE_ENV=development
process.env.NODE_ENV = 'test';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let replSet: MongoMemoryReplSet | null = null;
let isConnectedToAtlasTestDb = false;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
  process.env.MONGOMS_MD5_CHECK = 'false';

  // If a dedicated test DB URI is explicitly provided, use that
  const testMongoUri = process.env.TEST_MONGODB_URI;
  if (testMongoUri) {
    try {
      await mongoose.connect(testMongoUri);
      isConnectedToAtlasTestDb = true;
      return;
    } catch (err) {
      console.warn(
        'Could not connect to TEST_MONGODB_URI, falling back to MongoMemoryReplSet:',
        err
      );
    }
  }

  // Primary test runner: in-memory replica set (matches spec)
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });

  const uri = replSet.getUri();
  await mongoose.connect(uri);
}, 60000);

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    if (isConnectedToAtlasTestDb && mongoose.connection.db) {
      const collections = await mongoose.connection.db.collections();
      for (const collection of collections) {
        await collection.deleteMany({});
      }
    }
    await mongoose.disconnect();
  }
  if (replSet) {
    await replSet.stop();
  }
});

afterEach(async () => {
  if (mongoose.connection.readyState !== 0 && mongoose.connection.db) {
    const collections = await mongoose.connection.db.collections();
    for (const collection of collections) {
      await collection.deleteMany({});
    }
  }
});
