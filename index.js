const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');

const config = {
  BOT_TOKEN: process.env.BOT_TOKEN || '8420760390:AAGtL9WEudzISDb6CNcKv7HV2PqK-pwtrZI',
  ADMIN_ID: parseInt(process.env.ADMIN_ID) || 7520259263,
  ADMIN_SECRET: process.env.ADMIN_SECRET || 'mepro',
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb+srv://nigojbatakshumupa_db_user:AqfdCC9TrL1v6iVz@cluster0.qsainvs.mongodb.net/?appName=Cluster0',
  PORT: process.env.PORT || 3000,
  FREE_USER_LIMIT: 1000,
  PREMIUM_DEFAULT_LIMIT: 10000,
  MAX_FILE_SIZE: 10 * 1024 * 1024
};

if (!config.BOT_TOKEN) {
  console.error('BOT_TOKEN is required');
  process.exit(1);
}

mongoose.connect(config.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  retryWrites: true,
  w: 'majority'
}).then(() => {
  console.log('✅ Connected to MongoDB');
}).catch(err => {
  console.error('❌ MongoDB connection error:', err);
  process.exit(1);
});

const lineSchema = new mongoose.Schema({
  line: {
    type: String,
    required: true,
    trim: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 7 * 24 * 60 * 60
  }
});

const userSchema = new mongoose.Schema({
  telegramId: {
    type: Number,
    required: true,
    unique: true,
    index: true
  },
  username: String,
  firstName: String,
  lastName: String,
  premium: {
    type: Boolean,
    default: false
  },
  premiumLimit: {
    type: Number,
    default: 0
  },
  generatedToday: {
    type: Number,
    default: 0
  },
  lastGenerated: Date,
  totalGenerated: {
    type: Number,
    default: 0
  },
  joinedAt: {
    type: Date,
    default: Date.now
  }
});

const Line = mongoose.model('Line', lineSchema);
const User = mongoose.model('User', userSchema);

const bot = new TelegramBot(config.BOT_TOKEN, {
  polling: true,
  request: {
    timeout: 60000,
    agentOptions: {
      keepAlive: true,
      family: 4
    }
  }
});

bot.on('error', (error) => {
  console.error('❌ Telegram Bot Error:', error);
});

bot.on('polling_error', (error) => {
  console.error('❌ Telegram Polling Error:', error);
});

const app = express();

app.use(helmet({
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use('/api/', apiLimiter);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.MAX_FILE_SIZE
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/plain' || path.extname(file.originalname).toLowerCase() === '.txt') {
      cb(null, true);
    } else {
      cb(new Error('Only .txt files are allowed'), false);
    }
  }
});

async function getUser(telegramId, userInfo = {}) {
  try {
    let user = await User.findOne({ telegramId });
    if (!user) {
      user = new User({
        telegramId,
        username: userInfo.username,
        firstName: userInfo.first_name,
        lastName: userInfo.last_name,
        premium: false,
        premiumLimit: 0,
        generatedToday: 0,
        lastGenerated: null,
        totalGenerated: 0
      });
      await user.save();
      console.log(`👤 New user created: ${telegramId}`);
    }
    return user;
  } catch (error) {
    console.error('Error in getUser:', error);
    throw error;
  }
}

async function resetDailyCounters() {
  try {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await User.updateMany(
      { lastGenerated: { $lt: yesterday } },
      { $set: { generatedToday: 0, lastGenerated: null } }
    );
  } catch (error) {
    console.error('Error resetting daily counters:', error);
  }
}

setInterval(resetDailyCounters, 24 * 60 * 60 * 1000);

async function getUserGeneratedToday(telegramId) {
  const user = await getUser(telegramId);
  
  if (!user.lastGenerated) {
    return 0;
  }

  const lastGenerated = new Date(user.lastGenerated);
  const now = new Date();
  const diffMs = now - lastGenerated;

  if (diffMs >= 24 * 60 * 60 * 1000) {
    user.generatedToday = 0;
    user.lastGenerated = null;
    await user.save();
    return 0;
  }

  return user.generatedToday;
}

async function incrementUserCount(telegramId, count) {
  const user = await getUser(telegramId);
  const now = new Date();
  
  if (!user.lastGenerated || (now - new Date(user.lastGenerated)) >= 24 * 60 * 60 * 1000) {
    user.generatedToday = count;
  } else {
    user.generatedToday += count;
  }
  
  user.totalGenerated += count;
  user.lastGenerated = now;
  await user.save();
}

async function getLines(count) {
  return await Line.find().limit(count).sort({ createdAt: 1 });
}

async function deleteLines(ids) {
  if (ids.length === 0) return;
  await Line.deleteMany({ _id: { $in: ids } });
}

const commandHandlers = {
  async start(msg) {
    const chatId = msg.chat.id;
    await getUser(chatId, msg.from);
    
    const welcomeText = `**✧ 𖣂︎**\n\n**WELCOME TO FREE TXT BOT HERE YOU CAN GET TXT FOR FREE!**\n\n*✨ Commands:*
• Free 1K lines every 24 hours
• Fresh CODM TXT lines daily
• Premium plans for unlimited access
• Fast and reliable service

*📋 Available Commands:*
/txt - Get your free 1K lines
/stats - Check your usage stats
/txtsites - Learn about our sources
/help - Show all commands

**💎 Get PREMIUM for unlimited generating!**
*Enjoy using our bot! 🚀*`;

    const photoUrl = 'https://ibb.co/DHccdtnk';
    
    try {
      await bot.sendPhoto(chatId, photoUrl, {
        caption: welcomeText,
        parse_mode: 'Markdown'
      });
    } catch (error) {
      await bot.sendMessage(chatId, welcomeText, { parse_mode: 'Markdown' });
    }
  },

  async help(msg) {
    const chatId = msg.chat.id;
    const isAdmin = msg.from.id === config.ADMIN_ID;
    
    let helpMessage = `**📖 Available Commands:**\n\n`;
    helpMessage += `**For All Users:**\n`;
    helpMessage += `/start - Welcome message and bot info\n`;
    helpMessage += `/txt - Get your free 1K TXT lines (once per 24h)\n`;
    helpMessage += `/stats - Check your usage statistics\n`;
    helpMessage += `/txtsites - Learn about our TXT sources\n`;
    helpMessage += `/help - Show this help message\n\n`;
    helpMessage += `**💎 Premium Benefits:**\n`;
    helpMessage += `• Higher daily limits\n`;
    helpMessage += `• Priority access\n`;
    helpMessage += `• Better line quality\n\n`;
    helpMessage += `*Contact admin for premium plans!*`;

    if (isAdmin) {
      helpMessage += `\n\n**👑 Admin Commands:**\n`;
      helpMessage += `/stats - Bot statistics\n`;
      helpMessage += `Web Dashboard - Manage users and lines\n`;
    }

    await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
  },

  async stats(msg) {
    const chatId = msg.chat.id;
    const isAdmin = msg.from.id === config.ADMIN_ID;
    
    try {
      const user = await getUser(chatId);
      const generatedToday = await getUserGeneratedToday(chatId);
      const limit = user.premium ? user.premiumLimit : config.FREE_USER_LIMIT;
      const remaining = Math.max(0, limit - generatedToday);

      let statsMessage = `**📊 Your Statistics:**\n\n`;
      statsMessage += `**Status:** ${user.premium ? '💎 PREMIUM' : '🎫 FREE'}\n`;
      statsMessage += `**Daily Limit:** ${limit.toLocaleString()} lines\n`;
      statsMessage += `**Generated Today:** ${generatedToday.toLocaleString()} lines\n`;
      statsMessage += `**Remaining Today:** ${remaining.toLocaleString()} lines\n`;
      statsMessage += `**Total Generated:** ${user.totalGenerated.toLocaleString()} lines\n`;
      
      if (user.lastGenerated) {
        const nextAvailable = new Date(user.lastGenerated.getTime() + 24 * 60 * 60 * 1000);
        const now = new Date();
        if (now < nextAvailable && generatedToday >= limit) {
          const diff = nextAvailable - now;
          const h = Math.floor(diff / 3600000);
          const m = Math.floor((diff % 3600000) / 60000);
          statsMessage += `**Next Reset:** ${h}h ${m}m\n`;
        }
      }

      if (isAdmin) {
        const totalUsers = await User.countDocuments();
        const premiumUsers = await User.countDocuments({ premium: true });
        const totalLines = await Line.countDocuments();
        
        statsMessage += `\n**👑 Admin Statistics:**\n`;
        statsMessage += `**Total Users:** ${totalUsers}\n`;
        statsMessage += `**Premium Users:** ${premiumUsers}\n`;
        statsMessage += `**Lines Available:** ${totalLines.toLocaleString()}\n`;
      }

      await bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Error in stats command:', error);
      await bot.sendMessage(chatId, '❌ Error fetching statistics. Please try again.');
    }
  },

  async txt(msg) {
    const chatId = msg.chat.id;
    
    try {
      const user = await getUser(chatId);
      const generatedToday = await getUserGeneratedToday(chatId);
      const isPremium = user.premium;
      const limit = isPremium ? user.premiumLimit : config.FREE_USER_LIMIT;

      if (generatedToday >= limit) {
        const last = new Date(user.lastGenerated);
        const nextAvailable = new Date(last.getTime() + 24 * 60 * 60 * 1000);
        const now = new Date();
        
        if (now < nextAvailable) {
          const diff = nextAvailable - now;
          const h = Math.floor(diff / 3600000);
          const m = Math.floor((diff % 3600000) / 60000);
          const s = Math.floor((diff % 60000) / 1000);
          const waitTime = `${h}h ${m}m ${s}s`;
          
          const message = isPremium ? 
            `❌ You've reached your premium daily limit of ${limit.toLocaleString()} lines.\n⏰ Reset in: ${waitTime}` :
            `❌ You've reached your free daily limit of ${limit.toLocaleString()} lines.\n⏰ Reset in: ${waitTime}\n\n💎 Get PREMIUM for higher limits!`;
          
          return await bot.sendMessage(chatId, message);
        }
      }

      const toGet = Math.min(1000, limit - generatedToday);
      
      const lines = await getLines(toGet);
      
      if (!lines.length) {
        return await bot.sendMessage(chatId, '❌ No lines available at the moment. Please try again later.');
      }

      const text = lines.map(l => l.line).join('\n');
      const fileName = `PREM_${isPremium ? 'PREMIUM' : 'FREE'}_${Date.now()}.txt`;
      const tempPath = path.join(os.tmpdir(), fileName);
      
      await fs.writeFile(tempPath, text, 'utf8');
      
      await bot.sendDocument(
        chatId, 
        tempPath, 
        {},
        {
          filename: fileName,
          contentType: 'text/plain'
        }
      );

      await fs.unlink(tempPath);
      await deleteLines(lines.map(l => l._id));
      await incrementUserCount(chatId, lines.length);

      const successMessage = `✅ Successfully generated ${lines.length.toLocaleString()} lines!\n\n`;
      const remaining = Math.max(0, limit - (generatedToday + lines.length));
      
      if (remaining > 0) {
        successMessage += `📊 Remaining today: ${remaining.toLocaleString()} lines`;
      } else {
        successMessage += `⏰ Daily limit reached. Reset in 24 hours.`;
      }

      await bot.sendMessage(chatId, successMessage);

    } catch (error) {
      console.error('Error in txt command:', error);
      await bot.sendMessage(chatId, '❌ Error generating TXT file. Please try again later.');
    }
  },

  async txtsites(msg) {
    const chatId = msg.chat.id;
    const message = `**📚 About Our TXT Sources:**\n\n` +
      `Our TXT lines are carefully curated from various sources:\n\n` +
      `• **Manual Uploads** - Hand-picked by our team\n` +
      `• **Quality Control** - Each line is verified\n` +
      `• **Daily Updates** - Fresh content regularly\n` +
      `• **Multiple Formats** - Compatible with various tools\n\n` +
      `*For source suggestions, contact the admin!*`;
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }
};

bot.onText(/\/start/, (msg) => commandHandlers.start(msg));
bot.onText(/\/help/, (msg) => commandHandlers.help(msg));
bot.onText(/\/stats/, (msg) => commandHandlers.stats(msg));
bot.onText(/\/txt/, (msg) => commandHandlers.txt(msg));
bot.onText(/\/txtsites/, (msg) => commandHandlers.txtsites(msg));

app.post('/upload', upload.single('file'), async (req, res) => {
  if (req.query.secret !== config.ADMIN_SECRET) return res.status(403).send('Forbidden');
  
  try {
    const lines = req.file.buffer.toString()
      .split('\n')
      .map(line => ({ line: line.trim() }))
      .filter(x => x.line);
    
    await Line.insertMany(lines);
    res.json({ success: true, count: lines.length });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/users/:id/promote', async (req, res) => {
  if (req.query.secret !== config.ADMIN_SECRET) return res.status(403).send('Forbidden');
  
  try {
    const id = parseInt(req.params.id, 10);
    const limit = parseInt(req.body.limit, 10) || config.PREMIUM_DEFAULT_LIMIT;
    
    await User.updateOne(
      { telegramId: id }, 
      { premium: true, premiumLimit: limit }
    );
    
    await bot.sendMessage(id, `🎉 You are now a PREMIUM user with a daily limit of ${limit.toLocaleString()} lines.`);
    res.json({ success: true });
  } catch (error) {
    console.error('Promote error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/users/:id', async (req, res) => {
  if (req.query.secret !== config.ADMIN_SECRET) return res.status(403).send('Forbidden');
  
  try {
    const id = parseInt(req.params.id, 10);
    const user = await User.findOne({ telegramId: id });
    
    if (user && user.premium) {
      await bot.sendMessage(id, '⚠️ Your PREMIUM access has been removed. You are now limited to 1k lines per 24 hours.');
    }
    
    await User.deleteOne({ telegramId: id });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/users', async (req, res) => {
  if (req.query.secret !== config.ADMIN_SECRET) return res.status(403).send('Forbidden');
  
  try {
    const users = await User.find().sort({ joinedAt: -1 });
    res.json(users);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/lines', async (req, res) => {
  if (req.query.secret !== config.ADMIN_SECRET) return res.status(403).send('Forbidden');
  
  try {
    const count = await Line.countDocuments();
    res.json({ left: count });
  } catch (error) {
    console.error('Get lines error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/stats', async (req, res) => {
  if (req.query.secret !== config.ADMIN_SECRET) return res.status(403).send('Forbidden');
  
  try {
    const totalUsers = await User.countDocuments();
    const premiumUsers = await User.countDocuments({ premium: true });
    const totalLines = await Line.countDocuments();
    const totalGenerated = await User.aggregate([{ $group: { _id: null, total: { $sum: "$totalGenerated" } } }]);
    
    res.json({
      totalUsers,
      premiumUsers,
      freeUsers: totalUsers - premiumUsers,
      totalLines,
      totalGenerated: totalGenerated[0]?.total || 0
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.listen(config.PORT, () => {
  console.log(`🚀 Server running on port ${config.PORT}`);
});
