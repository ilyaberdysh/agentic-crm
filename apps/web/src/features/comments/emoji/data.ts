// Emoji set of the reaction picker ("Reactions": categorised grid, search by CLDR name — "thumbs" finds
// 👍 and 👎). A curated subset of Unicode emoji with their CLDR short names, written for this project.
// Format per category: "emoji name|emoji name|…".

const RAW: [string, string][] = [
  [
    'Smileys & Emotion',
    '😀 grinning face|😃 grinning face with big eyes|😄 grinning face with smiling eyes|😁 beaming face with smiling eyes|😆 grinning squinting face|😅 grinning face with sweat|🤣 rolling on the floor laughing|😂 face with tears of joy|🙂 slightly smiling face|🙃 upside-down face|😉 winking face|😊 smiling face with smiling eyes|😇 smiling face with halo|🥰 smiling face with hearts|😍 smiling face with heart-eyes|🤩 star-struck|😘 face blowing a kiss|😗 kissing face|☺️ smiling face|😚 kissing face with closed eyes|😙 kissing face with smiling eyes|😋 face savoring food|😛 face with tongue|😜 winking face with tongue|🤪 zany face|😝 squinting face with tongue|🤑 money-mouth face|🤗 smiling face with open hands|🤭 face with hand over mouth|🤫 shushing face|🤔 thinking face|🤐 zipper-mouth face|🤨 face with raised eyebrow|😐 neutral face|😑 expressionless face|😶 face without mouth|😏 smirking face|😒 unamused face|🙄 face with rolling eyes|😬 grimacing face|🤥 lying face|😌 relieved face|😔 pensive face|😪 sleepy face|🤤 drooling face|😴 sleeping face|😷 face with medical mask|🤒 face with thermometer|🤕 face with head-bandage|🤢 nauseated face|🤮 face vomiting|🤧 sneezing face|🥵 hot face|🥶 cold face|🥴 woozy face|😵 face with crossed-out eyes|🤯 exploding head|🤠 cowboy hat face|🥳 partying face|😎 smiling face with sunglasses|🤓 nerd face|🧐 face with monocle|😕 confused face|😟 worried face|🙁 slightly frowning face|😮 face with open mouth|😯 hushed face|😲 astonished face|😳 flushed face|🥺 pleading face|😦 frowning face with open mouth|😧 anguished face|😨 fearful face|😰 anxious face with sweat|😥 sad but relieved face|😢 crying face|😭 loudly crying face|😱 face screaming in fear|😖 confounded face|😣 persevering face|😞 disappointed face|😓 downcast face with sweat|😩 weary face|😫 tired face|🥱 yawning face|😤 face with steam from nose|😡 enraged face|😠 angry face|🤬 face with symbols on mouth|😈 smiling face with horns|💀 skull|💩 pile of poo|🤡 clown face|👻 ghost|👽 alien|🤖 robot|😺 grinning cat|😸 grinning cat with smiling eyes|😻 smiling cat with heart-eyes|🙈 see-no-evil monkey|🙉 hear-no-evil monkey|🙊 speak-no-evil monkey|💌 love letter|💘 heart with arrow|💝 heart with ribbon|💖 sparkling heart|💗 growing heart|💓 beating heart|💞 revolving hearts|💕 two hearts|❣️ heart exclamation|💔 broken heart|❤️ red heart|🧡 orange heart|💛 yellow heart|💚 green heart|💙 blue heart|💜 purple heart|🖤 black heart|🤍 white heart|💯 hundred points|💢 anger symbol|💥 collision|💫 dizzy|💦 sweat droplets|💨 dashing away|💬 speech balloon|💭 thought balloon|💤 zzz',
  ],
  [
    'People & Body',
    '👋 waving hand|🤚 raised back of hand|🖐️ hand with fingers splayed|✋ raised hand|🖖 vulcan salute|👌 ok hand|🤌 pinched fingers|🤏 pinching hand|✌️ victory hand|🤞 crossed fingers|🤟 love-you gesture|🤘 sign of the horns|🤙 call me hand|👈 backhand index pointing left|👉 backhand index pointing right|👆 backhand index pointing up|👇 backhand index pointing down|☝️ index pointing up|👍 thumbs up|👎 thumbs down|✊ raised fist|👊 oncoming fist|🤛 left-facing fist|🤜 right-facing fist|👏 clapping hands|🙌 raising hands|👐 open hands|🤲 palms up together|🤝 handshake|🙏 folded hands|✍️ writing hand|💅 nail polish|💪 flexed biceps|🧠 brain|👀 eyes|👁️ eye|👅 tongue|👄 mouth|👶 baby|🧒 child|👦 boy|👧 girl|🧑 person|👱 person: blond hair|👨 man|🧔 person: beard|👩 woman|🧓 older person|👴 old man|👵 old woman|🙍 person frowning|🙎 person pouting|🙅 person gesturing no|🙆 person gesturing ok|💁 person tipping hand|🙋 person raising hand|🧏 deaf person|🙇 person bowing|🤦 person facepalming|🤷 person shrugging|🧑‍💻 technologist|🧑‍💼 office worker|🧑‍🔬 scientist|🧑‍🎨 artist|🧑‍🚀 astronaut|🕵️ detective|💂 guard|🥷 ninja|👷 construction worker|🤴 prince|👸 princess|🦸 superhero|🧙 mage|🏃 person running|🚶 person walking|💃 woman dancing|🕺 man dancing|👯 people with bunny ears|🧘 person in lotus position|👭 women holding hands|👫 woman and man holding hands|👬 men holding hands|👪 family',
  ],
  [
    'Animals & Nature',
    '🐶 dog face|🐱 cat face|🐭 mouse face|🐹 hamster|🐰 rabbit face|🦊 fox|🐻 bear|🐼 panda|🐨 koala|🐯 tiger face|🦁 lion|🐮 cow face|🐷 pig face|🐸 frog|🐵 monkey face|🐔 chicken|🐧 penguin|🐦 bird|🐤 baby chick|🦆 duck|🦅 eagle|🦉 owl|🦇 bat|🐺 wolf|🐗 boar|🐴 horse face|🦄 unicorn|🐝 honeybee|🐛 bug|🦋 butterfly|🐌 snail|🐞 lady beetle|🐢 turtle|🐍 snake|🦖 t-rex|🐙 octopus|🦑 squid|🦀 crab|🐠 tropical fish|🐟 fish|🐬 dolphin|🐳 spouting whale|🦈 shark|🐊 crocodile|🐘 elephant|🦒 giraffe|🐿️ chipmunk|🦔 hedgehog|💐 bouquet|🌸 cherry blossom|🌹 rose|🌺 hibiscus|🌻 sunflower|🌼 blossom|🌷 tulip|🌱 seedling|🌲 evergreen tree|🌳 deciduous tree|🌴 palm tree|🌵 cactus|🍀 four leaf clover|🍁 maple leaf|🍂 fallen leaf|🌍 globe showing europe-africa|🌙 crescent moon|⭐ star|🌟 glowing star|✨ sparkles|⚡ high voltage|🔥 fire|🌈 rainbow|☀️ sun|⛅ sun behind cloud|☁️ cloud|🌧️ cloud with rain|❄️ snowflake|☃️ snowman|🌊 water wave',
  ],
  [
    'Food & Drink',
    '🍏 green apple|🍎 red apple|🍐 pear|🍊 tangerine|🍋 lemon|🍌 banana|🍉 watermelon|🍇 grapes|🍓 strawberry|🫐 blueberries|🍒 cherries|🍑 peach|🥭 mango|🍍 pineapple|🥥 coconut|🥝 kiwi fruit|🍅 tomato|🥑 avocado|🥦 broccoli|🥕 carrot|🌽 ear of corn|🌶️ hot pepper|🥐 croissant|🍞 bread|🥨 pretzel|🧀 cheese wedge|🥚 egg|🍳 cooking|🥞 pancakes|🥓 bacon|🍗 poultry leg|🍔 hamburger|🍟 french fries|🍕 pizza|🌭 hot dog|🥪 sandwich|🌮 taco|🌯 burrito|🥗 green salad|🍝 spaghetti|🍜 steaming bowl|🍣 sushi|🍱 bento box|🥟 dumpling|🍦 soft ice cream|🍩 doughnut|🍪 cookie|🎂 birthday cake|🍰 shortcake|🧁 cupcake|🍫 chocolate bar|🍬 candy|🍿 popcorn|☕ hot beverage|🍵 teacup without handle|🥤 cup with straw|🧋 bubble tea|🍺 beer mug|🍻 clinking beer mugs|🥂 clinking glasses|🍷 wine glass|🍸 cocktail glass|🍾 bottle with popping cork',
  ],
  [
    'Travel & Places',
    '🚗 automobile|🚕 taxi|🚌 bus|🏎️ racing car|🚓 police car|🚑 ambulance|🚒 fire engine|🚚 delivery truck|🚲 bicycle|🛴 kick scooter|🏍️ motorcycle|🚨 police car light|🚆 train|🚇 metro|✈️ airplane|🛫 airplane departure|🛬 airplane arrival|🚀 rocket|🛸 flying saucer|🚁 helicopter|⛵ sailboat|🚢 ship|⚓ anchor|🗺️ world map|🗽 statue of liberty|🗼 tokyo tower|🏰 castle|🏟️ stadium|🎡 ferris wheel|🎢 roller coaster|⛲ fountain|🏖️ beach with umbrella|🏝️ desert island|⛰️ mountain|🏔️ snow-capped mountain|🗻 mount fuji|🏕️ camping|🏠 house|🏡 house with garden|🏢 office building|🏬 department store|🏭 factory|🏦 bank|🏨 hotel|🏪 convenience store|🏫 school|🏥 hospital|⛪ church|🌃 night with stars|🌆 cityscape at dusk|🌉 bridge at night|🌅 sunrise|⌛ hourglass done|⏰ alarm clock|⏱️ stopwatch|🕐 one o’clock',
  ],
  [
    'Activities',
    '🎃 jack-o-lantern|🎄 christmas tree|🎆 fireworks|🎇 sparkler|🎈 balloon|🎉 party popper|🎊 confetti ball|🎁 wrapped gift|🎗️ reminder ribbon|🎟️ admission tickets|🏆 trophy|🏅 sports medal|🥇 1st place medal|🥈 2nd place medal|🥉 3rd place medal|⚽ soccer ball|⚾ baseball|🏀 basketball|🏐 volleyball|🏈 american football|🎾 tennis|🎳 bowling|🏓 ping pong|🏸 badminton|🥊 boxing glove|⛳ flag in hole|🎣 fishing pole|🎽 running shirt|🎿 skis|🛷 sled|🎯 bullseye|🎮 video game|🕹️ joystick|🎲 game die|🧩 puzzle piece|♟️ chess pawn|🎭 performing arts|🎨 artist palette|🎬 clapper board|🎤 microphone|🎧 headphone|🎼 musical score|🎹 musical keyboard|🥁 drum|🎷 saxophone|🎺 trumpet|🎸 guitar|🎻 violin',
  ],
  [
    'Objects',
    '⌚ watch|📱 mobile phone|💻 laptop|⌨️ keyboard|🖥️ desktop computer|🖨️ printer|🖱️ computer mouse|💽 computer disk|💾 floppy disk|💿 optical disk|📷 camera|📹 video camera|🎥 movie camera|📞 telephone receiver|☎️ telephone|📺 television|📻 radio|🎙️ studio microphone|⏳ hourglass not done|📡 satellite antenna|🔋 battery|🔌 electric plug|💡 light bulb|🔦 flashlight|🕯️ candle|🧯 fire extinguisher|💸 money with wings|💵 dollar banknote|💶 euro banknote|💰 money bag|💳 credit card|💎 gem stone|⚖️ balance scale|🧰 toolbox|🔧 wrench|🔨 hammer|⚙️ gear|🧲 magnet|🔬 microscope|🔭 telescope|📈 chart increasing|📉 chart decreasing|📊 bar chart|📋 clipboard|📌 pushpin|📍 round pushpin|📎 paperclip|📏 straight ruler|✂️ scissors|🗂️ card index dividers|📁 file folder|📂 open file folder|📅 calendar|📆 tear-off calendar|🗓️ spiral calendar|📇 card index|📝 memo|✏️ pencil|🖊️ pen|🖋️ fountain pen|📖 open book|📚 books|📓 notebook|📒 ledger|📜 scroll|📄 page facing up|📰 newspaper|🔖 bookmark|🏷️ label|✉️ envelope|📧 e-mail|📨 incoming envelope|📩 envelope with arrow|📤 outbox tray|📥 inbox tray|📦 package|📫 closed mailbox with raised flag|🗳️ ballot box with ballot|🔒 locked|🔓 unlocked|🔑 key|🗝️ old key|🛠️ hammer and wrench|🧪 test tube|💊 pill|🩺 stethoscope|🚪 door|🛋️ couch and lamp|🧹 broom|🛒 shopping cart|🎀 ribbon|🪄 magic wand|🔮 crystal ball|🧿 nazar amulet',
  ],
  [
    'Symbols',
    '✅ check mark button|☑️ check box with check|✔️ check mark|❌ cross mark|❎ cross mark button|➕ plus|➖ minus|➗ divide|✖️ multiply|❓ red question mark|❔ white question mark|❕ white exclamation mark|❗ red exclamation mark|‼️ double exclamation mark|⁉️ exclamation question mark|⚠️ warning|🚫 prohibited|⛔ no entry|📛 name badge|🔰 japanese symbol for beginner|♻️ recycling symbol|🔱 trident emblem|〰️ wavy dash|➰ curly loop|💲 heavy dollar sign|©️ copyright|®️ registered|™️ trade mark|🔝 top arrow|🔜 soon arrow|🔙 back arrow|🔛 on! arrow|🔚 end arrow|⬆️ up arrow|↗️ up-right arrow|➡️ right arrow|↘️ down-right arrow|⬇️ down arrow|↙️ down-left arrow|⬅️ left arrow|↖️ up-left arrow|↕️ up-down arrow|↔️ left-right arrow|🔄 counterclockwise arrows button|🔁 repeat button|▶️ play button|⏸️ pause button|⏹️ stop button|⏺️ record button|⏩ fast-forward button|⏪ fast reverse button|🔀 shuffle tracks button|🔔 bell|🔕 bell with slash|📣 megaphone|📢 loudspeaker|🔇 muted speaker|🔊 speaker high volume|🆕 new button|🆓 free button|🆗 ok button|🆒 cool button|🆙 up! button|🆘 sos button|🔴 red circle|🟠 orange circle|🟡 yellow circle|🟢 green circle|🔵 blue circle|🟣 purple circle|⚫ black circle|⚪ white circle|🟥 red square|🟧 orange square|🟨 yellow square|🟩 green square|🟦 blue square|🟪 purple square|⬛ black large square|⬜ white large square|🔶 large orange diamond|🔷 large blue diamond|🔺 red triangle pointed up|🔻 red triangle pointed down|💠 diamond with a dot|🔘 radio button|🔟 keycap: 10',
  ],
  [
    'Flags',
    '🏁 chequered flag|🚩 triangular flag|🎌 crossed flags|🏴 black flag|🏳️ white flag|🏳️‍🌈 rainbow flag|🇺🇳 flag: united nations|🇪🇺 flag: european union|🇺🇸 flag: united states|🇬🇧 flag: united kingdom|🇩🇪 flag: germany|🇫🇷 flag: france|🇪🇸 flag: spain|🇮🇹 flag: italy|🇳🇱 flag: netherlands|🇵🇹 flag: portugal|🇵🇱 flag: poland|🇺🇦 flag: ukraine|🇷🇺 flag: russia|🇹🇷 flag: turkey|🇮🇱 flag: israel|🇦🇪 flag: united arab emirates|🇮🇳 flag: india|🇨🇳 flag: china|🇯🇵 flag: japan|🇰🇷 flag: south korea|🇸🇬 flag: singapore|🇦🇺 flag: australia|🇨🇦 flag: canada|🇲🇽 flag: mexico|🇧🇷 flag: brazil|🇦🇷 flag: argentina|🇿🇦 flag: south africa|🇳🇬 flag: nigeria|🇪🇬 flag: egypt|🇰🇿 flag: kazakhstan|🇬🇪 flag: georgia|🇦🇲 flag: armenia|🇸🇪 flag: sweden|🇳🇴 flag: norway|🇫🇮 flag: finland|🇩🇰 flag: denmark|🇨🇭 flag: switzerland|🇦🇹 flag: austria|🇧🇪 flag: belgium|🇮🇪 flag: ireland|🇬🇷 flag: greece|🇨🇿 flag: czechia',
  ],
];

export interface EmojiEntry {
  emoji: string;
  name: string;
}

export interface EmojiCategory {
  name: string;
  emojis: EmojiEntry[];
}

export const EMOJI_CATEGORIES: EmojiCategory[] = RAW.map(([name, list]) => ({
  name,
  emojis: list.split('|').map((item) => {
    const space = item.indexOf(' ');
    return { emoji: item.slice(0, space), name: item.slice(space + 1) };
  }),
}));

const BY_EMOJI = new Map(EMOJI_CATEGORIES.flatMap((c) => c.emojis.map((e) => [e.emoji, e.name] as const)));

/** CLDR name of an emoji ("thumbs up"), for tooltips ("Ada reacted with 👍"). */
export function emojiName(emoji: string): string | undefined {
  return BY_EMOJI.get(emoji);
}

/** Search by name words ("thumbs" → 👍 👎), in category order. */
export function searchEmoji(query: string): EmojiEntry[] {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return EMOJI_CATEGORIES.flatMap((c) => c.emojis).filter((e) =>
    words.every((w) => e.name.split(/[\s:-]+/).some((part) => part.startsWith(w)) || e.name.includes(w)),
  );
}
