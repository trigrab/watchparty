import config from './config';
import Redis from 'ioredis';
import axios from 'axios';
import ecosystem from './ecosystem.config';

let redis: Redis.Redis | undefined = undefined;
if (config.REDIS_URL) {
  redis = new Redis(config.REDIS_URL);
}

statsTimeSeries();
setInterval(statsTimeSeries, 5 * 60 * 1000);

async function statsTimeSeries() {
  if (redis) {
    const ports =
      process.env.NODE_ENV === 'development'
        ? [8080]
        : ecosystem.apps
            .map((app) => app.env?.PORT)
            .filter(Boolean)
            // TODO remove this filter when sharding deployed
            .filter((port) => Number(port) === Number(config.PORT));
    const shardReqs = ports.map((port) =>
      axios({
        url: `http://localhost:${port}/stats?key=${config.STATS_KEY}`,
        validateStatus: () => true,
      })
    );

    const shardData = await Promise.all(shardReqs);

    let stats: any = {};
    shardData.forEach((shard) => {
      const data = shard.data;
      stats = combine(stats, data);
    });

    console.log(stats);

    await redis.lpush(
      'timeSeries',
      JSON.stringify({
        time: new Date(),
        availableVBrowsers: stats.availableVBrowsers?.length,
        availableVBrowsersLarge: stats.availableVBrowsersLarge?.length,
        currentUsers: stats.currentUsers,
        currentVBrowser: stats.currentVBrowser,
        currentVBrowserLarge: stats.currentVBrowserLarge,
        currentHttp: stats.currentHttp,
        currentScreenShare: stats.currentScreenShare,
        currentFileShare: stats.currentFileShare,
        currentVideoChat: stats.currentVideoChat,
        currentRoomCount: stats.currentRoomCount,
        chatMessages: stats.chatMessages,
        redisUsage: stats.redisUsage,
        avgStartMS:
          stats.vBrowserStartMS &&
          stats.vBrowserStartMS.reduce(
            (a: string, b: string) => Number(a) + Number(b),
            0
          ) / stats.vBrowserStartMS.length,
      })
    );
    await redis.ltrim('timeSeries', 0, 288);
  }
}

function combine(a: any, b: any) {
  const result = { ...a };
  Object.keys(b).forEach((key) => {
    if (key.startsWith('current')) {
      if (typeof b[key] === 'number') {
        result[key] = (result[key] || 0) + b[key];
      } else if (typeof b[key] === 'string') {
        result[key] = (result[key] || '') + b[key];
      } else if (Array.isArray(b[key])) {
        result[key] = [...(result[key] || []), ...b[key]];
      } else if (typeof b[key] === 'object') {
        result[key] = combine(result[key] || {}, b[key]);
      }
    } else {
      result[key] = a[key] || b[key];
    }
  });
  return result;
}
