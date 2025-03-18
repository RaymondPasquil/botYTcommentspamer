const { google } = require('googleapis');
const TelegramBot = require('node-telegram-bot-api');
const { OpenAI } = require('openai');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const openaiApiKey = process.env.OPENAI_API_KEY;

const bot = new TelegramBot(telegramToken, { polling: true });
const openai = new OpenAI({ apiKey: openaiApiKey });

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

const tokenFiles = fs.readdirSync('tokens').filter(file => file.endsWith('.json'));

const users = tokenFiles.map(file => {
    const credentials = JSON.parse(fs.readFileSync(`tokens/${file}`));
    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    oauth2Client.setCredentials(credentials);

    console.log(`✅ Loaded credentials for ${file.replace('.json', '')}`);

    return { username: file.replace('.json', ''), auth: oauth2Client, credentials };
});

if (users.length === 0) {
    console.error("❌ No authenticated Google accounts found! Run get_token.js to add accounts.");
    process.exit(1);
}

console.log(`✅ Loaded ${users.length} user accounts.`);


async function refreshAccessToken(user) {
    try {
        if (!user.auth.credentials || !user.auth.credentials.refresh_token) {
            console.error(`❌ No refresh token found for ${user.username}. Re-authenticating...`);
            await reauthenticateUser(user.username);
            return;
        }

        const { credentials } = await user.auth.refreshAccessToken();
        user.auth.setCredentials(credentials);

        // Ensure refresh_token is retained
        credentials.refresh_token = user.auth.credentials.refresh_token;

        // Save the updated tokens back to file
        fs.writeFileSync(`tokens/${user.username}.json`, JSON.stringify(credentials, null, 2));
        console.log(`🔄 Refreshed access token for ${user.username}`);
    } catch (error) {
        console.error(`❌ Error refreshing token for ${user.username}:`, error.message);

        // If "invalid_grant" error occurs, automatically re-authenticate
        if (error.message.includes("invalid_grant")) {
            console.log(`🔄 Re-authenticating ${user.username}...`);
            await reauthenticateUser(user.username);
        }
    }
}

const youtubeClients = users.map(user => ({
    username: user.username,
    youtube: google.youtube({ version: 'v3', auth: user.auth }),
}));

function extractVideoId(url) {
    const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/]+\/.*\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
}

async function getComments(videoId) {
    try {
        const res = await youtubeClients[0].youtube.commentThreads.list({
            part: 'snippet',
            videoId: videoId,
            maxResults: 50,
        });

        if (!res.data.items || res.data.items.length === 0) {
            return [];
        }

        return res.data.items.map(item => item.snippet.topLevelComment.snippet.textOriginal);
    } catch (error) {
        console.error('❌ Error fetching comments:', error.message);
        return [];
    }
}

async function generateReply(comment) {
    try {
        const openaiResponse = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: `Reply to this YouTube comment: "${comment}"` }],
        });

        return openaiResponse.choices[0]?.message?.content?.trim() || 'Thanks for your comment!';
    } catch (error) {
        console.error('❌ Error generating AI response:', error.message);
        return 'Thanks for your comment!';
    }
}
async function reauthenticateUser(username) {
    return new Promise((resolve, reject) => {
        const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
        const authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: ['https://www.googleapis.com/auth/youtube.force-ssl'],
        });

        console.log(`🔗 Open this link to re-authenticate ${username}: ${authUrl}`);

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        rl.question(`Enter the code from the page for ${username}: `, async (code) => {
            try {
                const { tokens } = await oauth2Client.getToken(code);
                oauth2Client.setCredentials(tokens);

                if (!fs.existsSync('tokens')) {
                    fs.mkdirSync('tokens');
                }

                fs.writeFileSync(`tokens/${username}.json`, JSON.stringify(tokens, null, 2));
                console.log(`✅ Successfully re-authenticated ${username}`);
                resolve();
            } catch (error) {
                console.error(`❌ Error re-authenticating ${username}:`, error.message);
                reject(error);
            }
            rl.close();
        });
    });
}

async function postComment(videoId, text) {
    for (const user of youtubeClients) {
        try {
            if (!user.auth.credentials || !user.auth.credentials.access_token) {
                console.error(`❌ No valid credentials found for ${user.username}. Skipping...`);
                continue;
            }
            await refreshAccessToken(user);
            await user.youtube.commentThreads.insert({
                part: 'snippet',
                requestBody: {
                    snippet: {
                        videoId: videoId,
                        topLevelComment: { snippet: { textOriginal: text } },
                    },
                },
            });
            console.log(`✅ Comment posted by ${user.username}: "${text}"`);
        } catch (error) {
            console.error(`❌ Error posting comment for ${user.username}:`, error.message);
        }
    }
}

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🤖 Welcome! Send me a YouTube link, and I will post a comment for you.');
});

bot.onText(/(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/, async (msg, match) => {
    const chatId = msg.chat.id;
    const videoUrl = match[0];
    const videoId = extractVideoId(videoUrl);

    if (!videoId) {
        bot.sendMessage(chatId, '❌ Invalid YouTube link. Please try again.');
        return;
    }

    bot.sendMessage(chatId, '🔍 Fetching comments...');
    const comments = await getComments(videoId);

    if (comments.length > 0) {
        const randomComment = comments[Math.floor(Math.random() * comments.length)];
        const reply = await generateReply(randomComment);
        await postComment(videoId, reply);
        bot.sendMessage(chatId, `✅ Comments posted successfully!`);
    } else {
        bot.sendMessage(chatId, '⚠️ No comments found on that video.');
    }
});

console.log('🤖 Bot is running...');
