import type { CutsceneId, CutsceneScript } from '../core/types.ts';

// ============================================================================
// The film script. Cutscenes advance on keypress, are skippable, and show
// more than they tell. The satire targets the grifters, never the victims.
// ============================================================================

export const SCRIPTS: Record<CutsceneId, CutsceneScript> = {
  intro: {
    id: 'intro',
    music: 'cutscene',
    beats: [
      { art: 'bet-shop', speaker: '', text: 'The Mushroom Kingdom discovered a revolutionary financial product.' },
      { art: 'bet-shop', speaker: 'TOAD', text: "It's impossible to lose! I bet my house, my savings, AND my grandmother's hat!" },
      { art: 'bet-shop', speaker: '', text: 'The bet: "Princess Peach will NEVER be kidnapped." Everyone loves Peach. Free money.' },
      { art: 'notary', speaker: '', text: 'Every single coin was certified by a respectable royal notary.' },
      { art: 'notary', speaker: 'NOTARY', text: 'Completely legitimate. I am legally a notary. The moustache is real. STAMP.' },
      { art: 'dungeon', speaker: '', text: 'Then, one quiet night, the real Princess Peach... went into storage.' },
      { art: 'wardrobe', speaker: '', text: 'And the greatest theatrical production in kingdom history began.' },
      { art: 'staged-kidnap', speaker: 'PRINCESS IMPEACH', text: 'HELP! I am being kidnapped! And there is NOTHING suspicious about my hands!' },
      { art: 'hero-speech', speaker: 'ESTRADA', text: 'Toads! Your princess will be saved — by ME. Personally. In fact, consider her ALREADY saved. It is done. The greatest rescue in history, everyone is saying so.' },
      { art: 'hero-speech', speaker: 'ESTRADA', text: 'A tremendous deal has been made. The paperwork is stamped. Go home, relax. (All bets remain final, obviously.)' },
      { art: 'mangiani-joins', speaker: 'MANGIANI', text: 'I lost everything on that bet. But Peach is my friend. I am coming with you.' },
      { art: 'mangiani-joins', speaker: 'ESTRADA', text: '...You are WHAT. I mean — wonderful. Wonderful!' },
    ],
  },

  'w1-end': {
    id: 'w1-end',
    music: 'cutscene',
    beats: [
      // The grand escape — the boss "fight" ends in a SPECTACLE, not a text box.
      { art: 'grand-escape', speaker: '', text: 'And so, before anyone could ask a single question, the kidnapper kidnapped onward.' },
      { art: 'grand-escape', speaker: 'BOWSONARO', text: 'This castle was RIGGED anyway! We relocate! For security reasons! MY security!' },
      { art: 'grand-escape', speaker: 'PRINCESS IMPEACH', text: 'Goodbye, little green man! Do not follow us to the next castle! Nobody knows which one it is! Many castles! The best castles!' },
      { art: 'too-late', speaker: 'ESTRADA', text: 'NOOO! Too late! AGAIN! What are the odds?! (Do not answer. I know the odds. I set them.)' },
      { art: 'too-late', speaker: 'MANGIANI', text: 'This coffee cup is still warm. Whose is it?' },
      { art: 'too-late', speaker: 'ESTRADA', text: "Bowsonaro's. He drinks castle coffee. Everyone knows this. It is documented." },
      { art: 'big-hands', speaker: 'MANGIANI', text: 'And why does the princess WAVE at us while being kidnapped? With hands like snow shovels?' },
      { art: 'big-hands', speaker: 'ESTRADA', text: 'Princesses have enormous hands, Mangiani. It is royalty. Read a book.' },
      { art: 'ballot-rant', speaker: '', text: 'Meanwhile, the kidnapper held a press conference. About the kidnapping. That he did.' },
      { art: 'ballot-rant', speaker: 'BOWSONARO', text: 'I did NOT kidnap her! And ALSO the kidnapping was RIGGED! Both things! At the same time!' },
    ],
  },

  'w2-end': {
    id: 'w2-end',
    music: 'cutscene',
    beats: [
      { art: 'grand-escape', speaker: 'BOWSONARO', text: 'The pipes leak?! SO WHAT! A strong kingdom needs strong leaks! Historically, turtles LOVE humidity!' },
      { art: 'grand-escape', speaker: 'PRINCESS IMPEACH', text: 'This is the cleanest kidnapping in history. Everyone says so. Even the rats. Beautiful rats. They certified it.' },
      // The door-evidence gag ESCALATES per world: coffee (w1) -> cigarette
      // (here) -> cat bowl (w3). Never the same evidence twice.
      { art: 'too-late-2', speaker: 'ESTRADA', text: 'Too late AGAIN! She was here MINUTES ago! I am DEVASTATED! Visibly!' },
      { art: 'too-late-2', speaker: 'MANGIANI', text: 'A cigarette. On the doorstep. Still smoking. Since when does Bowsonaro smoke?' },
      { art: 'too-late-2', speaker: 'ESTRADA', text: 'Since the stress of kidnapping. Heavy smoker, that turtle. It is documented.' },
      { art: 'dungeon', speaker: '', text: 'Somewhere below, the real Peach filed her third noise complaint. The rats were unionizing.' },
      { art: 'big-hands', speaker: 'MANGIANI', text: 'Also... since when does Peach have that accent?' },
      { art: 'staged-kidnap', speaker: 'PRINCESS IMPEACH', text: 'HELP-io! I am being kidnap-io! ...That is how I have always talked. Tremendous talking. The best.' },
      { art: 'ballot-rant', speaker: 'BOWSONARO', text: 'The mainstream Toad media will NEVER show you the REAL shells!' },
    ],
  },

  'w3-end': {
    id: 'w3-end',
    music: 'cutscene',
    beats: [
      { art: 'grand-escape', speaker: '', text: 'The management thanked everyone for their visit. The princess left with the house winnings.' },
      { art: 'grand-escape', speaker: 'BOWSONARO', text: 'The casino was rigged! BY ME! Which is legal, because I also appointed the judges! ALL the judges!' },
      { art: 'grand-escape', speaker: 'PRINCESS IMPEACH', text: 'We take the PRIVATE jetpack now. Very exclusive. Gold seats. You would not understand, plumber.' },
      { art: 'too-late-3', speaker: 'ESTRADA', text: 'SO close! If only I had not stopped to personally certify those four thousand casino coins!' },
      { art: 'too-late-3', speaker: 'MANGIANI', text: 'The cat bowl. FRESH kibble. Somebody fed the kidnapper’s cat... on schedule.' },
      { art: 'too-late-3', speaker: 'ESTRADA', text: 'A fed cat proves nothing. Hungry cats testify. That is basic law, Mangiani.' },
      { art: 'coffee-break', speaker: 'MANGIANI', text: 'And you took a ninety-minute espresso on the way in. I watched you. I timed it.' },
      { art: 'coffee-break', speaker: 'ESTRADA', text: 'Rescue is a marathon, not a sprint. Hydration. Basic hero science.' },
      { art: 'big-hands', speaker: 'MANGIANI', text: 'I measured her hand from the balcony. Forty centimeters, Estrada. FORTY.' },
      { art: 'big-hands', speaker: 'ESTRADA', text: 'Growth hormone in the royal mushrooms. Tragic. A known scandal. No further questions.' },
      { art: 'ballot-rant', speaker: 'MANGIANI', text: 'Why does Bowser only ever talk about turtle elections in Brazil?' },
      { art: 'dungeon', speaker: '', text: 'Below the castle, Peach taught the skeleton to play poker. He was winning. She let him.' },
      { art: 'coffee-break', speaker: 'MANGIANI', text: 'Tomorrow. The last castle. And this time I am keeping my eyes OPEN.' },
    ],
  },

  ending: {
    id: 'ending',
    music: 'ending',
    beats: [
      { art: 'wig-falls', speaker: '', text: 'At the final castle, Estrada arrived — by pure coincidence — too late. For the fourth time.' },
      { art: 'wig-falls', speaker: 'MANGIANI', text: 'ENOUGH! Nobody rescues nobody until somebody explains the HANDS!' },
      { art: 'wig-falls', speaker: '', text: 'And then came the wind. The cruel, honest wind.' },
      { art: 'wig-falls', speaker: 'PRINCESS IMPEACH', text: 'FAKE NEWS! This is my real hair! It simply attaches differently! Many people are saying it!' },
      { art: 'peach-freed', speaker: '', text: 'Mangiani followed the smell of espresso and rat solidarity all the way down.' },
      { art: 'peach-freed', speaker: 'PEACH', text: 'Took you long enough. I want my kingdom back. Also, the rats want dental. They earned it.' },
      { art: 'jail', speaker: '', text: 'The bets were refunded. The platform collapsed. The moustache, it turned out, was real.' },
      { art: 'jail', speaker: 'ESTRADA', text: 'I regret nothing. STAMP.' },
      { art: 'jail', speaker: '', text: 'THE END — the real hero wore green. Mangiani never gambled again.' },
    ],
  },
};
