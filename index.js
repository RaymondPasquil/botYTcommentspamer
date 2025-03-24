const { google } = require('googleapis');
const TelegramBot = require('node-telegram-bot-api');
const { OpenAI } = require('openai');
require('dotenv').config();
const fs = require('fs');

const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const openaiApiKey = process.env.OPENAI_API_KEY;
const GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_ID;

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

const youtubeClients = users.map(user => ({
    username: user.username,
    auth: user.auth,
    youtube: google.youtube({ version: 'v3', auth: user.auth }),
}));

async function refreshAccessToken(user) {
    try {
        if (!user.auth.credentials || !user.auth.credentials.refresh_token) {
            console.error(`❌ No refresh token found for ${user.username}. Re-authenticating...`);
            return;
        }

        console.log(`🔄 Refreshing access token for ${user.username}...`);
        const { credentials } = await user.auth.refreshAccessToken();
        user.auth.setCredentials(credentials);
        credentials.refresh_token = user.auth.credentials.refresh_token;
        fs.writeFileSync(`tokens/${user.username}.json`, JSON.stringify(credentials, null, 2));
        console.log(`🔄 Refreshed access token for ${user.username}`);
    } catch (error) {
        console.error(`❌ Error refreshing token for ${user.username}:`, error.message);
    }
}

function extractVideoId(url) {
    const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:shorts\/|watch\?v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
}

async function getCommentsOrMetadata(videoId, youtube) {
    try {
        const res = await youtube.commentThreads.list({
            part: 'snippet',
            videoId,
            maxResults: 50,
        });

        const comments = res.data.items?.map(item =>
            item.snippet.topLevelComment.snippet.textOriginal
        ) || [];

        if (comments.length > 0) {
            return { type: 'comments', data: comments };
        }

        console.log('⚠️ No comments found. Fetching video metadata...');
        const videoRes = await youtube.videos.list({
            part: 'snippet',
            id: videoId,
        });

        const video = videoRes.data.items?.[0]?.snippet;
        if (video) {
            const combined = `${video.title || ''}\n\n${video.description || ''}`.trim();
            return { type: 'metadata', data: combined || 'a YouTube video' };
        }

        return { type: 'fallback', data: 'a YouTube video' };
    } catch (error) {
        console.error('❌ Error fetching video data:', error.message);
        return { type: 'fallback', data: 'a YouTube video' };
    }
}

async function generateReply(input, sourceType) {
    try {
        const keywords = ['gold888', 'polaslot88', 'wings365'];
        const chosenKeyword = keywords[Math.floor(Math.random() * keywords.length)];

        const prompt = sourceType === 'comments'
            ? `Respond casually and naturally to this YouTube comment like a real viewer. Make it one sentence, avoid generic phrases like "thanks" or "great video", and include ONLY this keyword: ${chosenKeyword}. Here's the comment: "${input}"`
            : `Write a short, natural-sounding one-sentence YouTube comment about this video. Avoid generic praise. Make it feel like a real viewer reaction, and include ONLY this keyword: ${chosenKeyword}. Here's the video info: "${input}"`;

        const openaiResponse = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: prompt }],
        });

        let reply = openaiResponse.choices[0]?.message?.content?.trim();

        if (!reply || reply.length < 3) {
            reply = `This part really hit different. #${chosenKeyword}`;
        }

        const keywordPattern = new RegExp(`\\b(${keywords.join('|')})\\b`, 'gi');
        const matches = reply.match(keywordPattern);
        if (!matches || matches.length !== 1 || !matches[0].toLowerCase().includes(chosenKeyword)) {
            reply += ` #${chosenKeyword}`;
        }

        reply = reply.replace(/^\w+:\s*/, '');
        return reply;
    } catch (error) {
        console.error(`❌ Error generating AI response:`, error.message);
        return `Kinda vibing with this one. #gold888`;
    }
}

async function postComment(videoId, source) {
    for (const user of youtubeClients) {
        try {
            if (!user.auth?.credentials?.access_token) {
                console.error(`❌ No valid credentials for ${user.username}. Skipping...`);
                continue;
            }

            console.log(`🔍 Posting comment for ${user.username}...`);
            await refreshAccessToken(user);

            const input = source.type === 'comments'
                ? source.data[Math.floor(Math.random() * source.data.length)]
                : source.data;

            const reply = await generateReply(input, source.type);

            await user.youtube.commentThreads.insert({
                part: 'snippet',
                requestBody: {
                    snippet: {
                        videoId,
                        topLevelComment: { snippet: { textOriginal: reply } },
                    },
                },
            });

            console.log(`✅ Comment posted by ${user.username}: "${reply}"`);
        } catch (error) {
            console.error(`❌ Error posting comment for ${user.username}:`, error.message);
        }
    }
}

// Manual commenting from links
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text || msg.caption;

    if (!text) return;

    const youtubeLink = text.match(/(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/);
    if (!youtubeLink) return;

    const videoUrl = youtubeLink[0];
    const videoId = extractVideoId(videoUrl);

    if (!videoId) {
        bot.sendMessage(chatId, '❌ Invalid YouTube link. Please try again.');
        return;
    }

    bot.sendMessage(chatId, '🔍 Analyzing the video...');
    const source = await getCommentsOrMetadata(videoId, youtubeClients[0].youtube);

    await postComment(videoId, source);
    bot.sendMessage(chatId, `✅ Comments posted successfully by all users!${source.type === 'metadata' ? ' (based on video info)' : ''}`);
});

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🤖 Welcome! Send me a YouTube link (normal or Shorts), and I’ll post a comment using all available accounts.');
});

// 🔥 Trending video poster
const postedVideoIds = new Set();

async function getTrendingVideosInIndonesia(youtube, maxResults = 5) {
    try {
        const response = await youtube.videos.list({
            part: 'snippet',
            chart: 'mostPopular',
            regionCode: 'ID',
            maxResults,
        });

        return response.data.items.map(video => ({
            id: video.id,
            title: video.snippet.title,
            url: `https://www.youtube.com/watch?v=${video.id}`,
        }));
    } catch (error) {
        console.error(`❌ Error fetching trending videos:`, error.message);
        return [];
    }
}

async function fetchAndPostTrending(bot, youtube, chatId, maxResults = 5) {
    const videos = await getTrendingVideosInIndonesia(youtube, maxResults);
    const newVideos = videos.filter(video => !postedVideoIds.has(video.id));
    if (newVideos.length === 0) return;

    newVideos.forEach(video => postedVideoIds.add(video.id));

    let message = "🔥 *Trending YouTube Videos in Indonesia:*\n\n";
    newVideos.forEach((vid, i) => {
        message += `${i + 1}. [${vid.title}](${vid.url})\n`;
    });

    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
}

bot.onText(/\/viral/, async (msg) => {
    const chatId = msg.chat.id;
    await fetchAndPostTrending(bot, youtubeClients[0].youtube, chatId);
});

// ⏰ Auto-post trending every 5 mins
setInterval(() => {
    fetchAndPostTrending(bot, youtubeClients[0].youtube, GROUP_CHAT_ID);
}, 5 * 60 * 1000);

console.log('🤖 Bot is running...');