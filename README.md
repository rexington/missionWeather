# Mission Peak Weather Worker

A Cloudflare Worker that provides detailed weather reports for Mission Peak trail runs, specifically for Tuesday and Thursday morning runs.

## Features

- Fetches weather data for both trailhead and summit locations
- Detects temperature inversions
- Analyzes cloud cover and marine layer conditions
- Reports wind conditions
- Sends formatted reports to Slack

## Setup

1. Install Wrangler CLI:
```bash
npm install -g wrangler
```

2. Login to Cloudflare:
```bash
wrangler login
```

3. Set up your secrets:
```bash
wrangler secret put SLACK_WEBHOOK_URL
```

4. Deploy the worker:
```bash
wrangler deploy
```

## Configuration

The worker is configured to run at 8pm PT on Monday and Wednesday nights, providing weather reports for the next morning's run.

### Schedule and Timezone Handling

The worker is scheduled to run at 3am UTC on Monday and Wednesday. This ensures it runs at 8pm PT regardless of daylight savings time:

- During Pacific Standard Time (PST, November-March):
  - 3am UTC = 7pm PT (UTC-8)
- During Pacific Daylight Time (PDT, March-November):
  - 3am UTC = 8pm PT (UTC-7)

To maintain a consistent 8pm PT runtime year-round, we would need to adjust the schedule twice a year. For simplicity, the worker is scheduled to run at 3am UTC, which means:
- During PST: Reports will be sent at 7pm PT
- During PDT: Reports will be sent at 8pm PT

Note: Cloudflare Workers cron uses a different day numbering system than standard cron:
- 1 = Sunday
- 2 = Monday
- 3 = Tuesday
- 4 = Wednesday
- 5 = Thursday
- 6 = Friday
- 7 = Saturday

## Testing

### Local Testing

1. Create a `.dev.vars` file in the project root with your environment variables:
```
MISSION_PEAK_SUMMIT_LAT=37.5133
MISSION_PEAK_SUMMIT_LON=-121.8800
MISSION_PEAK_SUMMIT_ELEVATION=767
TRAILHEAD_LAT=37.5100
TRAILHEAD_LON=-121.8800
TRAILHEAD_ELEVATION=0
SLACK_WEBHOOK_URL=your_slack_webhook_url_here
```

2. Start the development server:
```bash
wrangler dev
```

3. Test the worker by visiting:
```
http://localhost:8787/test
```
or using curl:
```bash
curl http://localhost:8787/test
```

### Production Testing

After deploying the worker, you can test it by visiting:
```
https://mission-weather.[your-worker-subdomain].workers.dev/test
```

The test endpoint will:
- Fetch current weather data
- Process it just like the scheduled job would
- Send the report to your Slack channel
- Return a success message

This allows you to verify that:
- The API calls are working
- The data processing is correct
- The Slack integration is functioning
- The message formatting looks good

## Required API Keys

- Slack Webhook URL (create an incoming webhook in your Slack workspace)

## Weather Data Sources

The worker uses Open-Meteo API to fetch:
- Temperature at trailhead and summit
- Wind conditions
- Cloud cover data
- Additional atmospheric conditions 