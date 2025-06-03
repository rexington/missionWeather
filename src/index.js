// Mission Peak Weather Worker
// Fetches weather data for Mission Peak trail and sends to Slack

const OPEN_METEO_BASE_URL = 'https://api.open-meteo.com/v1/forecast';

async function fetchWeatherData(lat, lon, elevation) {
  try {
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      elevation: elevation,
      hourly: 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high',
      timezone: 'America/Los_Angeles',
      temperature_unit: 'fahrenheit'
    });

    const url = `${OPEN_METEO_BASE_URL}?${params.toString()}`;
    console.log('Fetching weather data from:', url);
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Open-Meteo API error: ${response.status} ${response.statusText}`);
    }
    return response.json();
  } catch (error) {
    console.error('Error fetching weather data:', error);
    throw error;
  }
}

function getNextMorningData(hourlyData) {
  // Get data for 5am (next morning)
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(5, 0, 0, 0);
  
  const targetTime = tomorrow.toISOString();
  const index = hourlyData.time.findIndex(time => time.startsWith(targetTime.split('T')[0]));
  
  return {
    temperature: hourlyData.temperature_2m[index],
    humidity: hourlyData.relative_humidity_2m[index],
    windSpeed: hourlyData.wind_speed_10m[index],
    windDirection: hourlyData.wind_direction_10m[index],
    cloudCover: hourlyData.cloud_cover[index],
    lowClouds: hourlyData.cloud_cover_low[index],
    midClouds: hourlyData.cloud_cover_mid[index],
    highClouds: hourlyData.cloud_cover_high[index]
  };
}

function detectInversion(trailheadTemp, summitTemp) {
  // Temperature inversion occurs when summit is warmer than trailhead
  return summitTemp > trailheadTemp;
}

function analyzeCloudLayer(lowClouds, midClouds, highClouds) {
  const marineLayer = lowClouds > 70; // Marine layer typically forms in low clouds
  const cloudBase = lowClouds > 50 ? "Low" : midClouds > 50 ? "Mid" : highClouds > 50 ? "High" : "Clear";
  
  let description = "";
  if (marineLayer) {
    description = "Marine layer present";
  } else if (lowClouds > 80) {
    description = "Heavy low cloud cover";
  } else if (midClouds > 80) {
    description = "Heavy mid-level cloud cover";
  } else if (highClouds > 80) {
    description = "Heavy high cloud cover";
  } else if (lowClouds > 50 || midClouds > 50 || highClouds > 50) {
    description = "Moderate cloud cover";
  } else {
    description = "Clear skies";
  }
  
  return {
    description,
    marineLayer,
    cloudBase
  };
}

function formatWindSpeed(speed) {
  if (speed < 5) return "Calm";
  if (speed < 10) return "Light breeze";
  if (speed < 15) return "Moderate breeze";
  if (speed < 20) return "Strong breeze";
  return "High winds";
}

function getWindDirection(degrees) {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(degrees / 45) % 8;
  return directions[index];
}

async function sendToSlack(message, webhookUrl) {
  try {
    // Ensure the webhook URL is properly encoded
    const url = new URL(webhookUrl);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: message,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Slack API error: ${response.status} ${response.statusText}`);
    }
    
    return response.ok;
  } catch (error) {
    console.error('Error sending to Slack:', error);
    throw error;
  }
}

export default {
  async fetch(request, env, ctx) {
    // Only allow GET requests for testing
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Check for a test parameter
    const url = new URL(request.url);
    if (url.pathname === '/test' || url.searchParams.get('test') === 'true') {
      try {
        console.log('Starting test weather report...');
        
        // Reuse the same logic as the scheduled function
        const summitData = await fetchWeatherData(
          env.MISSION_PEAK_SUMMIT_LAT,
          env.MISSION_PEAK_SUMMIT_LON,
          env.MISSION_PEAK_SUMMIT_ELEVATION
        );
        
        const trailheadData = await fetchWeatherData(
          env.TRAILHEAD_LAT,
          env.TRAILHEAD_LON,
          env.TRAILHEAD_ELEVATION
        );

        const summitMorning = getNextMorningData(summitData.hourly);
        const trailheadMorning = getNextMorningData(trailheadData.hourly);

        const summitTemp = Math.round(summitMorning.temperature);
        const trailheadTemp = Math.round(trailheadMorning.temperature);
        const hasInversion = detectInversion(trailheadTemp, summitTemp);
        const cloudAnalysis = analyzeCloudLayer(
          summitMorning.lowClouds,
          summitMorning.midClouds,
          summitMorning.highClouds
        );
        
        const message = `🌄 *Mission Peak Weather Report for Tomorrow Morning* 🌄\n\n` +
          `*Trailhead Conditions:*\n` +
          `• Temperature: ${trailheadTemp}°F\n` +
          `• Wind: ${formatWindSpeed(trailheadMorning.windSpeed)} from ${getWindDirection(trailheadMorning.windDirection)}\n` +
          `• Humidity: ${trailheadMorning.humidity}%\n\n` +
          `*Summit Conditions:*\n` +
          `• Temperature: ${summitTemp}°F\n` +
          `• Wind: ${formatWindSpeed(summitMorning.windSpeed)} from ${getWindDirection(summitMorning.windDirection)}\n` +
          `• Humidity: ${summitMorning.humidity}%\n\n` +
          `*Special Conditions:*\n` +
          `• Cloud Cover: ${cloudAnalysis.description}\n` +
          `• Cloud Base: ${cloudAnalysis.cloudBase}\n` +
          `• Marine Layer: ${cloudAnalysis.marineLayer ? 'Yes' : 'No'}\n` +
          `• Temperature Inversion: ${hasInversion ? 'Yes' : 'No'}\n\n` +
          `_Data provided by Open-Meteo API_`;

        // Send to Slack
        await sendToSlack(message, env.SLACK_WEBHOOK_URL);
        
        return new Response('Test weather report sent successfully', { status: 200 });
      } catch (error) {
        console.error('Error in test endpoint:', error);
        return new Response(`Error: ${error.message}`, { 
          status: 500,
          headers: {
            'Content-Type': 'text/plain'
          }
        });
      }
    }

    return new Response('Not found', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    try {
      // Fetch weather data for both locations
      const summitData = await fetchWeatherData(
        env.MISSION_PEAK_SUMMIT_LAT,
        env.MISSION_PEAK_SUMMIT_LON,
        env.MISSION_PEAK_SUMMIT_ELEVATION
      );
      
      const trailheadData = await fetchWeatherData(
        env.TRAILHEAD_LAT,
        env.TRAILHEAD_LON,
        env.TRAILHEAD_ELEVATION
      );

      // Get next morning's data
      const summitMorning = getNextMorningData(summitData.hourly);
      const trailheadMorning = getNextMorningData(trailheadData.hourly);

      // Process the data
      const summitTemp = Math.round(summitMorning.temperature);
      const trailheadTemp = Math.round(trailheadMorning.temperature);
      const hasInversion = detectInversion(trailheadTemp, summitTemp);
      const cloudAnalysis = analyzeCloudLayer(
        summitMorning.lowClouds,
        summitMorning.midClouds,
        summitMorning.highClouds
      );
      
      // Format the message
      const message = `🌄 *Mission Peak Weather Report for Tomorrow Morning* 🌄\n\n` +
        `*Trailhead Conditions:*\n` +
        `• Temperature: ${trailheadTemp}°F\n` +
        `• Wind: ${formatWindSpeed(trailheadMorning.windSpeed)} from ${getWindDirection(trailheadMorning.windDirection)}\n` +
        `• Humidity: ${trailheadMorning.humidity}%\n\n` +
        `*Summit Conditions:*\n` +
        `• Temperature: ${summitTemp}°F\n` +
        `• Wind: ${formatWindSpeed(summitMorning.windSpeed)} from ${getWindDirection(summitMorning.windDirection)}\n` +
        `• Humidity: ${summitMorning.humidity}%\n\n` +
        `*Special Conditions:*\n` +
        `• Cloud Cover: ${cloudAnalysis.description}\n` +
        `• Cloud Base: ${cloudAnalysis.cloudBase}\n` +
        `• Marine Layer: ${cloudAnalysis.marineLayer ? 'Yes' : 'No'}\n` +
        `• Temperature Inversion: ${hasInversion ? 'Yes' : 'No'}\n\n` +
        `_Data provided by Open-Meteo API_`;

      // Send to Slack
      await sendToSlack(message, env.SLACK_WEBHOOK_URL);
      
      return new Response('Weather report sent successfully', { status: 200 });
    } catch (error) {
      return new Response(`Error: ${error.message}`, { status: 500 });
    }
  },
}; 