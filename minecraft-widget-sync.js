require('dotenv').config();
const axios = require('axios');

const POLL_INTERVAL_MS = 15 * 60 * 1000;
const ASHCON_API_BASE_URL = 'https://api.ashcon.app/mojang/v2/user';
const DISCORD_API_BASE_URL = 'https://discord.com/api/v9';

const config = {
  mcUsername: process.env.MC_USERNAME?.trim(),
  discordBotToken: process.env.DISCORD_BOT_TOKEN?.trim(),
  applicationId: process.env.APPLICATION_ID?.trim(),
  discordUserId: (process.env.DISCORD_USER_ID || '').replace(/\D/g, '')
};

function validateConfig() {
  const missing = [];

  if (!config.mcUsername) missing.push('MC_USERNAME');
  if (!config.discordBotToken) missing.push('DISCORD_BOT_TOKEN');
  if (!config.applicationId) missing.push('APPLICATION_ID');
  if (!config.discordUserId) missing.push('DISCORD_USER_ID');

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

const USER_AGENT = 'mc-discord-widget-sync/1.0.0';

function formatJoinDate(joinedAt) {
  if (!joinedAt) {
    return 'Joined: Unknown';
  }

  return `Joined: ${new Date(joinedAt).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })}`;
}

function buildWidgetPayload(stats) {
  // Payload Struktur analog zum originalen Skript
  const payload = {
    username: stats.username,
    data: {
      dynamic: [
        { type: 1, name: 'accountage', value: stats.accountAge },
        { type: 2, name: 'namechanges', value: stats.nameChanges },
        { type: 1, name: 'customskin', value: stats.hasCustomSkin },
        { type: 2, name: 'capes', value: stats.capeCount },
        { type: 3, name: 'skin', value: { url: stats.skinUrl } } // Typ 3 erwartet ein Objekt mit 'url'
      ]
    }
  };

  return payload;
}

async function fetchMCProfileData() {
  console.log(`Fetching public Minecraft stats for ${config.mcUsername}...`);

  const headers = {
    'User-Agent': USER_AGENT
  };

  try {
    const profileResponse = await axios.get(
      `${ASHCON_API_BASE_URL}/${encodeURIComponent(config.mcUsername)}`,
      { headers }
    );

    const userData = profileResponse.data || {};
    
    // Account age
    const accountAge = userData.created_at ? formatJoinDate(userData.created_at) : 'Joined: Unknown';
    
    // Name changes
    const nameChanges = userData.username_history ? Math.max(0, userData.username_history.length - 1) : 0;
    
    // Custom Skin
    const hasCustomSkin = userData.textures?.custom ? 'Yes' : 'No';
    const skinUrl = userData.textures?.skin?.url || null;

    // Capes
    const capeCount = userData.textures?.cape ? 1 : 0;

    return {
      username: userData.username || config.mcUsername,
      accountAge: accountAge,
      nameChanges: nameChanges,
      hasCustomSkin: hasCustomSkin,
      capeCount: capeCount,
      skinUrl: skinUrl
    };
  } catch (error) {
    throw new Error(`Unable to fetch Minecraft profile data: ${error.message}`);
  }
}

async function pushDataToDiscordWidget(stats) {
  console.log('Sending widget payload to Discord...');

  try {
    await axios.patch(
      `${DISCORD_API_BASE_URL}/applications/${config.applicationId}/users/${config.discordUserId}/identities/0/profile`,
      buildWidgetPayload(stats),
      {
        headers: {
          Authorization: `Bot ${config.discordBotToken}`,
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT
        }
      }
    );

    console.log('Sync complete.');
  } catch (error) {
    const errorDetails = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    throw new Error(`Discord update failed: ${errorDetails}`);
  }
}

let syncInProgress = false;

async function runSynchronizationPipeline() {
  if (syncInProgress) {
    console.warn('A sync cycle is already running. Skipping this interval.');
    return;
  }

  syncInProgress = true;
  console.log(`\n[${new Date().toLocaleTimeString()}] Starting sync cycle...`);

  try {
    const mcStats = await fetchMCProfileData();
    await pushDataToDiscordWidget(mcStats);
  } catch (error) {
    console.error(error.message);
  } finally {
    syncInProgress = false;
  }
}

if (process.env.GITHUB_ACTIONS === 'true') {
  // Wenn es über GitHub Actions läuft, nur einmal ausführen und dann beenden
  validateConfig();
  runSynchronizationPipeline().then(() => {
    console.log("GitHub Action run finished.");
    process.exit(0);
  });
} else {
  // Lokaler Modus mit Intervall
  validateConfig();
  void runSynchronizationPipeline();
  setInterval(() => {
    void runSynchronizationPipeline();
  }, POLL_INTERVAL_MS);
}
