// Mission Peak Weather Worker
// Fetches weather data for Mission Peak trail and sends to Slack

const OPEN_METEO_BASE_URL = 'https://api.open-meteo.com/v1/forecast';
const AIR_QUALITY_BASE_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

async function fetchWeatherData(lat, lon, elevation) {
  try {
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      elevation: elevation,
      hourly: 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,precipitation_probability,shortwave_radiation,cape',
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

function getAQIDescription(aqi) {
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy for Sensitive Groups";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very Unhealthy";
  return "Hazardous";
}

async function fetchAirQualityData(lat, lon) {
  try {
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      hourly: 'us_aqi',
      timezone: 'America/Los_Angeles'
    });

    const url = `${AIR_QUALITY_BASE_URL}?${params.toString()}`;
    console.log('Fetching air quality data from:', url);
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Air Quality API error: ${response.status} ${response.statusText}`);
    }
    return response.json();
  } catch (error) {
    console.error('Error fetching air quality data:', error);
    throw error;
  }
}

function getNextMorningData(hourlyData, targetHour = 5) {
  // Get data for specified hour
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(targetHour, 0, 0, 0);
  
  const targetTime = tomorrow.toISOString();
  console.log('Looking for data at:', targetTime);
  
  // Find the exact hour in the data
  const index = hourlyData.time.findIndex(time => {
    const dataTime = new Date(time);
    return dataTime.getHours() === targetHour && 
           dataTime.getDate() === tomorrow.getDate() &&
           dataTime.getMonth() === tomorrow.getMonth();
  });
  
  if (index === -1) {
    console.error('Could not find data for target time:', targetTime);
    throw new Error(`No weather data available for ${formatTime(targetHour)}`);
  }
  
  console.log('Found data at index:', index, 'time:', hourlyData.time[index]);
  
  return {
    temperature: hourlyData.temperature_2m[index],
    humidity: hourlyData.relative_humidity_2m[index],
    windSpeed: hourlyData.wind_speed_10m[index],
    windDirection: hourlyData.wind_direction_10m[index],
    cloudCover: hourlyData.cloud_cover[index],
    lowClouds: hourlyData.cloud_cover_low[index],
    midClouds: hourlyData.cloud_cover_mid[index],
    highClouds: hourlyData.cloud_cover_high[index],
    precipitationProbability: hourlyData.precipitation_probability[index],
    solarRadiation: hourlyData.shortwave_radiation[index],
    cape: hourlyData.cape[index]
  };
}

function detectInversion(trailheadTemp, summitTemp) {
  // Temperature inversion occurs when summit is warmer than trailhead
  return summitTemp > trailheadTemp;
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

function formatTime(hour) {
  if (hour === 0) return '12am';
  if (hour === 12) return '12pm';
  if (hour < 12) return `${hour}am`;
  return `${hour - 12}pm`;
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

function getSunriseTime(date) {
  // Approximate sunrise time for Mission Peak area (varies by season)
  // Using 6:30am as average sunrise time
  const sunrise = new Date(date);
  sunrise.setHours(6, 30, 0, 0);
  return sunrise;
}

function estimateSweatLoss(temperature, humidity, windSpeed, elevation, solarRadiation) {
  // Constants
  const WEIGHT = 180; // lbs
  const DISTANCE = 6.22; // miles
  const ELEVATION_GAIN = 2150; // feet
  
  // Estimate duration based on elevation gain and distance
  // Using a rough formula: base pace + elevation adjustment
  const basePace = 10; // minutes per mile
  const elevationFactor = ELEVATION_GAIN / 1000;
  const estimatedDuration = (basePace + elevationFactor) * DISTANCE; // in minutes
  
  // Base sweat rate (ml/hour) at 70°F, 50% humidity, no wind
  const baseSweatRate = 650;
  
  // Temperature factor (increases sweat rate by ~10% per 5°F above 70°F)
  const tempFactor = 1 + ((temperature - 70) / 5) * 0.1;
  
  // Humidity factor (increases sweat rate by ~5% per 10% above 50% humidity)
  const humidityFactor = 1 + ((humidity - 50) / 10) * 0.05;
  
  // Wind factor (decreases sweat rate by ~5% per 5mph)
  const windFactor = 1 - (windSpeed / 5) * 0.05;
  
  // Elevation factor (increases sweat rate by ~5% per 1000ft)
  const elevationSweatFactor = 1 + (ELEVATION_GAIN / 1000) * 0.05;

  // Solar radiation factor (W/m²)
  // Typical values: 0 at night, up to 1000+ in full sun
  // Scale the effect from 0 to 75% increase
  const solarFactor = 1 + (Math.min(solarRadiation / 1000, 1) * 0.75);
  
  // Calculate total sweat loss
  let sweatLoss = baseSweatRate * 
                  tempFactor * 
                  humidityFactor * 
                  windFactor * 
                  elevationSweatFactor * 
                  solarFactor *
                  (estimatedDuration / 60); // Convert to hours
  
  // Convert to liters
  sweatLoss = sweatLoss / 1000; // Convert ml to liters
  
  return {
    liters: Math.round(sweatLoss * 10) / 10, // Round to 1 decimal place
    duration: Math.round(estimatedDuration)
  };
}

function getGloveRecommendation(trailheadTemp, summitTemp) {
  const avgTemp = (trailheadTemp + summitTemp) / 2;
  if (avgTemp < 40) return "Yes, definitely";
  if (avgTemp < 45) return "Yes, recommended";
  if (avgTemp < 52) return "Maybe, if you run cold";
  return "No";
}

function getThunderstormPotential(cape) {
  if (cape > 2500) return "High thunderstorm potential";
  if (cape > 1500) return "Moderate thunderstorm potential";
  if (cape > 1000) return "Low thunderstorm potential";
  return null; // No significant thunderstorm potential
}

async function generateWeatherReport(env, targetHour = 5) {
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

  // Fetch air quality data for both locations
  const summitAQData = await fetchAirQualityData(
    env.MISSION_PEAK_SUMMIT_LAT,
    env.MISSION_PEAK_SUMMIT_LON
  );
  
  const trailheadAQData = await fetchAirQualityData(
    env.TRAILHEAD_LAT,
    env.TRAILHEAD_LON
  );

  const summitMorning = getNextMorningData(summitData.hourly, targetHour);
  const trailheadMorning = getNextMorningData(trailheadData.hourly, targetHour);
  
  // Get air quality data for the target hour
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(targetHour, 0, 0, 0);
  const targetTime = tomorrow.toISOString();
  
  const summitAQIndex = summitAQData.hourly.us_aqi[summitAQData.hourly.time.findIndex(time => 
    new Date(time).getHours() === targetHour && 
    new Date(time).getDate() === tomorrow.getDate() &&
    new Date(time).getMonth() === tomorrow.getMonth()
  )];
  
  const trailheadAQIndex = trailheadAQData.hourly.us_aqi[trailheadAQData.hourly.time.findIndex(time => 
    new Date(time).getHours() === targetHour && 
    new Date(time).getDate() === tomorrow.getDate() &&
    new Date(time).getMonth() === tomorrow.getMonth()
  )];

  const summitTemp = Math.round(summitMorning.temperature);
  const trailheadTemp = Math.round(trailheadMorning.temperature);
  const hasInversion = detectInversion(trailheadTemp, summitTemp);
  
  // Calculate estimated sweat loss
  const sweatEstimate = estimateSweatLoss(
    (trailheadTemp + summitTemp) / 2, // Average temperature
    (trailheadMorning.humidity + summitMorning.humidity) / 2, // Average humidity
    (trailheadMorning.windSpeed + summitMorning.windSpeed) / 2, // Average wind speed
    2150, // Elevation gain
    (trailheadMorning.solarRadiation + summitMorning.solarRadiation) / 2 // Average solar radiation
  );
  
  const timeStr = targetHour === 5 ? 'Tomorrow Morning' : `Tomorrow at ${formatTime(targetHour)}`;
  
  // Only show air quality if it's unhealthy (AQI > 100)
  const airQualityLine = summitAQIndex > 100 ? 
    `• Air Quality: ${summitAQIndex} (${getAQIDescription(summitAQIndex)})\n` : '';
  
  // Only show precipitation chance if it's above 10%
  const precipitationLine = summitMorning.precipitationProbability > 10 ?
    `• Chance of Rain: ${summitMorning.precipitationProbability}%\n` : '';
  
  // Check for thunderstorm potential using CAPE
  const thunderstormPotential = getThunderstormPotential(summitMorning.cape);
  const thunderstormLine = thunderstormPotential ? 
    `• ${thunderstormPotential}\n` : '';
  
  return `🌄 *Mission Peak Weather Report for ${timeStr}* 🌄\n\n` +
    `• Temperature: ${trailheadTemp}°F, Humidity: ${trailheadMorning.humidity}%\n` +
    `• Wind: ${formatWindSpeed(summitMorning.windSpeed)} from ${getWindDirection(summitMorning.windDirection)}\n` +
    precipitationLine +
    thunderstormLine +
    airQualityLine +
    `• Cloud Cover: Low ${Math.round(summitMorning.lowClouds)}%, Mid ${Math.round(summitMorning.midClouds)}%, High ${Math.round(summitMorning.highClouds)}%\n` +
    `• Temperature Inversion: ${hasInversion ? 'Yes' : 'No'}\n` +
    `• Estimated Sweat Loss: ${sweatEstimate.liters}L\n` +
    `• Gloves Needed: ${getGloveRecommendation(trailheadTemp, summitTemp)}\n\n` +
    `_Data provided by Open-Meteo API_`;
}

async function verifySlackRequest(request, signingSecret) {
  try {
    const timestamp = request.headers.get('x-slack-request-timestamp');
    const signature = request.headers.get('x-slack-signature');
    
    console.log('Verifying Slack request:', { timestamp, signature });
    
    if (!timestamp || !signature) {
      console.error('Missing Slack headers:', { timestamp, signature });
      return false;
    }

    // Verify request is not older than 5 minutes
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > 300) {
      console.error('Request too old:', { now, timestamp, diff: Math.abs(now - timestamp) });
      return false;
    }

    // Get the raw body
    const body = await request.text();
    console.log('Request body:', body);
    
    // Create the signature base string
    const sigBase = `v0:${timestamp}:${body}`;
    
    // Create HMAC
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(signingSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signatureBase = encoder.encode(sigBase);
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, signatureBase);
    const signatureArray = Array.from(new Uint8Array(signatureBuffer));
    const signatureHex = signatureArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    const isValid = `v0=${signatureHex}` === signature;
    console.log('Signature verification:', { 
      calculated: `v0=${signatureHex}`,
      received: signature,
      isValid 
    });
    
    return { isValid, body };
  } catch (error) {
    console.error('Error verifying Slack request:', error);
    return { isValid: false, body: null };
  }
}

export default {
  async fetch(request, env, ctx) {
    console.log('Received request:', {
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers.entries())
    });

    // Handle Slack slash command
    if (request.method === 'POST') {
      try {
        // Verify the request is from Slack
        const { isValid, body } = await verifySlackRequest(request, env.SLACK_SIGNING_SECRET);
        console.log('Slack request validation result:', isValid);
        
        if (!isValid) {
          return new Response('Unauthorized', { status: 401 });
        }

        // Parse the body as form data
        const formData = new URLSearchParams(body);
        const command = formData.get('command');
        const responseUrl = formData.get('response_url');
        const text = formData.get('text') || '';
        console.log('Received command:', command, 'with text:', text);

        // Parse the time from the command text
        let targetHour = 5; // default to 5am
        const timeMatch = text.match(/(\d{1,2})(?:\s*(?:am|pm))?/i);
        if (timeMatch) {
          let hour = parseInt(timeMatch[1]);
          const isPM = text.toLowerCase().includes('pm');
          const isAM = text.toLowerCase().includes('am');
          
          // Handle 12-hour format
          if (isPM && hour < 12) hour += 12;
          if (isAM && hour === 12) hour = 0;
          
          // Validate hour is between 0 and 23
          if (hour >= 0 && hour <= 23) {
            targetHour = hour;
          }
        }
        
        if (command === '/mission-weather') {
          console.log('Generating weather report for', formatTime(targetHour), '...');
          const message = await generateWeatherReport(env, targetHour);
          
          // Send the response back to the originating channel
          const response = await fetch(responseUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              response_type: 'in_channel',
              text: message
            })
          });
          
          if (!response.ok) {
            throw new Error(`Failed to send response to Slack: ${response.status} ${response.statusText}`);
          }
          
          // Return an empty 200 response to acknowledge receipt
          return new Response(null, { status: 200 });
        }
      } catch (error) {
        console.error('Error handling slash command:', error);
        return new Response(JSON.stringify({
          response_type: 'ephemeral',
          text: `Error: ${error.message}`
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Handle test endpoint
    if (request.method === 'GET') {
      const url = new URL(request.url);
      if (url.pathname === '/test' || url.searchParams.get('test') === 'true') {
        try {
          const message = await generateWeatherReport(env);
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
    }

    return new Response('Not found', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    try {
      const message = await generateWeatherReport(env);
      await sendToSlack(message, env.SLACK_WEBHOOK_URL);
      return new Response('Weather report sent successfully', { status: 200 });
    } catch (error) {
      return new Response(`Error: ${error.message}`, { status: 500 });
    }
  },
}; 