import TelegramBot, { Message, KeyboardButton } from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import {
  getVideosByTag,
  getAllTags,
  addVideo,
  isDuplicateUrl,
} from '../googleSheets';

dotenv.config();

const bot = new TelegramBot(process.env.BOT_TOKEN as string, { polling: true });

interface UserState {
  step: string;
  data: {
    tag?: string;
    count?: number;
    title?: string;
    url?: string;
    tags?: string;
    selectedTags?: string[];
    tagChoiceMode?: 'list' | 'manual';
  };
}

const userStates = new Map<number, UserState>();

function sendSafeMessage(bot: TelegramBot, chatId: number, message: string) {
  const safeText = message.trim();
  return safeText.length > 0 ? bot.sendMessage(chatId, safeText) : Promise.resolve();
}

function keyboardFromLabels(labels: string[][]): KeyboardButton[][] {
  return labels.map(row => row.map(label => ({ text: label })));
}

function showMainMenu(chatId: number) {
  userStates.delete(chatId);
  bot.sendMessage(chatId, '👋 What would you like to do?', {
    reply_markup: {
      keyboard: keyboardFromLabels([['📽 Get Videos', '➕ Add Video']]),
      one_time_keyboard: true,
    },
  });
}

bot.onText(/\/start/, (msg: Message) => {
  showMainMenu(msg.chat.id);
});

bot.onText(/\/clean/, async (msg: Message) => {
  const chatId = msg.chat.id;
  const lastMsgId = msg.message_id;
  const statusMsg = await bot.sendMessage(chatId, '🧹 Cleaning up the chat...');
  for (let i = lastMsgId; i > lastMsgId - 200; i--) {
    try {
      await bot.deleteMessage(chatId, i);
    } catch {}
  }
  try {
    await bot.deleteMessage(chatId, statusMsg.message_id);
  } catch {}
  bot.sendMessage(chatId, '✅ Chat cleaned. Type /start to begin again.');
});

bot.on('message', async (msg: Message) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  const state = userStates.get(chatId);
  if (!text || text.startsWith('/')) return;

  if (text === '🏠 Main Menu') return showMainMenu(chatId);

  if (text.includes('instagram.com') && !state) {
    const isDuplicate = await isDuplicateUrl(text);
    if (isDuplicate) return sendSafeMessage(bot, chatId, '⚠️ This video already exists.');

    userStates.set(chatId, {
      step: 'awaiting_password_for_link',
      data: { url: text },
    });
    return sendSafeMessage(bot, chatId, '🔒 Instagram link detected. Please enter the admin password to continue.\n\n(You can always type /start to return to the main menu)');
  }

  if (text === '📽 Get Videos') {
    const tags = await getAllTags();
    if (tags.length === 0) return sendSafeMessage(bot, chatId, '⚠️ No tags found.');
    userStates.set(chatId, { step: 'awaiting_tag', data: {} });
    return bot.sendMessage(chatId, 'Choose a tag:', {
      reply_markup: {
        keyboard: keyboardFromLabels(tags.map(tag => [tag])),
        one_time_keyboard: true,
      },
    });
  }

  if (text === '➕ Add Video') {
    userStates.set(chatId, { step: 'awaiting_password', data: {} });
    return sendSafeMessage(bot, chatId, '🔒 Please enter the admin password.\n\n(You can always type /start to return to the main menu)');
  }

  if (text === '➕ Add Another') {
    userStates.set(chatId, { step: 'awaiting_title', data: {} });
    return sendSafeMessage(bot, chatId, 'What is the video title?\n\n(You can always type /start to return to the main menu)');
  }

  if (!state) return;

  switch (state.step) {
    case 'awaiting_password_for_link':
    case 'awaiting_password':
      if (text === process.env.ADMIN_PASSWORD) {
        try { await bot.deleteMessage(chatId, msg.message_id); } catch {}
        state.step = state.step === 'awaiting_password_for_link' ? 'awaiting_title_for_link' : 'awaiting_title';
        userStates.set(chatId, state);
        return sendSafeMessage(bot, chatId, '✅ Password accepted.\n\nWhat is the video title?\n\n(You can always type /start to return to the main menu)');
      } else {
        return sendSafeMessage(bot, chatId, '❌ Incorrect password. Please try again.\n\n(You can always type /start to return to the main menu)');
      }

    case 'awaiting_title_for_link':
      state.data.title = text;
      state.step = 'choose_tag_mode';
      userStates.set(chatId, state);
      return bot.sendMessage(chatId, 'How would you like to enter tags?', {
        reply_markup: {
          keyboard: keyboardFromLabels([['🗂 Choose from List', '⌨️ Type My Own']]),
          one_time_keyboard: true,
        },
      });

    case 'awaiting_title':
      state.data.title = text;
      state.step = 'awaiting_url';
      userStates.set(chatId, state);
      return sendSafeMessage(bot, chatId, '📎 Send the Instagram video URL.\n\n(You can always type /start to return to the main menu)');

    case 'awaiting_url':
      if (!text.includes('instagram.com')) return sendSafeMessage(bot, chatId, '❌ Please enter a valid Instagram link.\n\n(You can always type /start to return to the main menu)');
      const isDuplicate = await isDuplicateUrl(text);
      if (isDuplicate) {
        sendSafeMessage(bot, chatId, '⚠️ This video already exists.');
        userStates.delete(chatId);
        return;
      }
      state.data.url = text;
      state.step = 'choose_tag_mode';
      userStates.set(chatId, state);
      return bot.sendMessage(chatId, 'How would you like to enter tags?', {
        reply_markup: {
          keyboard: keyboardFromLabels([['🗂 Choose from List', '⌨️ Type My Own']]),
          one_time_keyboard: true,
        },
      });

    case 'choose_tag_mode':
      if (text === '🗂 Choose from List') {
        const tags = await getAllTags();
        state.data.selectedTags = [];
        state.data.tagChoiceMode = 'list';
        state.step = 'choosing_tags';
        userStates.set(chatId, state);
        return bot.sendMessage(chatId, 'Select tags (tap multiple). Type ✅ when done.', {
          reply_markup: {
            keyboard: keyboardFromLabels([...tags.map(tag => [tag]), ['✅ Done']]),
            one_time_keyboard: false,
          },
        });
      }
      if (text === '⌨️ Type My Own') {
        state.data.tagChoiceMode = 'manual';
        state.step = 'awaiting_tags';
        userStates.set(chatId, state);
        return sendSafeMessage(bot, chatId, 'Enter tags separated by commas (e.g. strength, mobility).\n\n(You can always type /start to return to the main menu)');
      }
      return bot.sendMessage(chatId, '❌ Please choose a valid option:', {
        reply_markup: {
          keyboard: keyboardFromLabels([['🗂 Choose from List', '⌨️ Type My Own']]),
          one_time_keyboard: true,
        },
      });

    case 'choosing_tags':
      if (text === '✅ Done') {
        const tags = (state.data.selectedTags || []).join(',');
        if (!tags) return sendSafeMessage(bot, chatId, '⚠️ No tags selected. Please choose at least one.');
        await addVideo(state.data.title!, state.data.url!, tags);
        userStates.delete(chatId);
        return bot.sendMessage(chatId, '✅ Video added successfully!\nWhat next?', {
          reply_markup: {
            keyboard: keyboardFromLabels([['➕ Add Another', '🏠 Main Menu']]),
            one_time_keyboard: true,
          },
        });
      }
      const allTags = await getAllTags();
      if (allTags.includes(text.toLowerCase())) {
        if (!state.data.selectedTags?.includes(text.toLowerCase())) {
          state.data.selectedTags!.push(text.toLowerCase());
          userStates.set(chatId, state);
        }
        return sendSafeMessage(bot, chatId, `✅ Tag "${text}" added. Keep going or type ✅ when done.`);
      }
      return bot.sendMessage(chatId, '❌ Invalid tag. Choose from the list or type ✅ when done.', {
        reply_markup: {
          keyboard: keyboardFromLabels([...allTags.map(tag => [tag]), ['✅ Done']]),
          one_time_keyboard: false,
        },
      });

    case 'awaiting_tags': {
      const tags = text.toLowerCase().split(',').map((t: string) => t.trim()).join(',');
      state.data.tags = tags;
      await addVideo(state.data.title!, state.data.url!, tags);
      userStates.delete(chatId);
      return bot.sendMessage(chatId, '✅ Video added successfully!\nWhat next?', {
        reply_markup: {
          keyboard: keyboardFromLabels([['➕ Add Another', '🏠 Main Menu']]),
          one_time_keyboard: true,
        },
      });
    }

    case 'awaiting_tag':
      state.data.tag = text;
      state.step = 'awaiting_count';
      userStates.set(chatId, state);
      return bot.sendMessage(chatId, 'How many videos would you like?', {
        reply_markup: {
          keyboard: keyboardFromLabels([['1'], ['2'], ['3'], ['4'], ['5']]),
          one_time_keyboard: true,
        },
      });

    case 'awaiting_count': {
      const count = parseInt(text);
      if (isNaN(count) || count < 1 || count > 5) return sendSafeMessage(bot, chatId, 'Please select a number between 1 and 5.');
      const videos = await getVideosByTag(state.data.tag!, count);
      if (videos.length === 0) {
        sendSafeMessage(bot, chatId, `No videos found for tag "${state.data.tag}".`);
        userStates.delete(chatId);
        return;
      }
      videos.forEach(video => sendSafeMessage(bot, chatId, `🎬 ${video.title}\n🔗 ${video.url}`));
      if (videos.length < count) sendSafeMessage(bot, chatId, `Only ${videos.length} video(s) available.`);
      state.step = 'post_get_options';
      userStates.set(chatId, state);
      return bot.sendMessage(chatId, 'What next?', {
        reply_markup: {
          keyboard: keyboardFromLabels([['🔄 Switch Type', '🏠 Main Menu']]),
          one_time_keyboard: true,
        },
      });
    }

    case 'post_get_options':
      if (text === '🔄 Switch Type') {
        const tags = await getAllTags();
        state.step = 'awaiting_tag';
        userStates.set(chatId, state);
        return bot.sendMessage(chatId, 'Choose a tag:', {
          reply_markup: {
            keyboard: keyboardFromLabels(tags.map(tag => [tag])),
            one_time_keyboard: true,
          },
        });
      }
      return sendSafeMessage(bot, chatId, 'Please choose a valid option.\n\n(You can always type /start to return to the main menu)');
  }
});