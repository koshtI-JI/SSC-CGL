export const DEST_TARGET_KEYSTROKES = 2000;
export const DEST_DURATION_SECONDS = 15 * 60; // 15 minutes
export const COMPUTER_QUIZ_DURATION_SECONDS = 15 * 60; // 15 minutes
export const COMPUTER_QUIZ_COUNT = 20;

export interface DestPassage {
  id: string;
  title: string;
  difficulty: 'Standard' | 'Moderate';
  text: string;
}

export const DEST_PASSAGES: DestPassage[] = [
  {
    id: 'dest_digital_india',
    title: 'Digital Public Infrastructure & Economic Inclusion',
    difficulty: 'Standard',
    text:
      'Over the past decade, digital public infrastructure has reshaped civic service delivery and formal financial participation across diverse regions of India. Open digital rails combining verifiable identity, interoperable instant payments, and paperless document wallets have significantly lowered transaction friction for millions of citizens and small enterprises. Rural entrepreneurs who once relied exclusively on cash ledgers now receive direct settlements within seconds, enabling transparent credit histories and wider market access. At the same time, public institutions are automating grievance redressal, tax administration, and scholarship disbursements so that eligible beneficiaries receive timely support without intermediary delays. However, sustained digital growth requires continuous investment in cybersecurity hygiene, regional language accessibility, and resilient last-mile connectivity. Training local administrative staff alongside strengthening data privacy safeguards ensures that technological modernization translates into measurable public trust. When citizens experience reliable, intuitive digital platforms, administrative efficiency improves naturally, creating a durable foundation for inclusive economic development and transparent governance in the decades ahead. Consistent keyboard speed and precision remain vital skills for modern secretariat officials managing high-volume digital correspondence, audit tables, and inter-ministerial briefs accurately within tight statutory timelines. Regular practice builds muscle memory, reduces proofreading errors, and ensures calm performance under strict examination conditions. By focusing equally on rhythm and accuracy, every aspirant can cross the two-thousand keystroke benchmark comfortably with time to verify punctuation, capitalization, and spacing before final submission of the official assessment. Careful attention to numeric entries, date formats, and official designations further minimizes avoidable transcription mistakes during data entry skill tests across central ministries and autonomous departments.',
  },
  {
    id: 'dest_urban_ecology',
    title: 'Sustainable Urban Transport & Climate Resilience',
    difficulty: 'Moderate',
    text:
      'Rapid urbanization places unprecedented pressure on municipal water networks, public transit corridors, and ambient air quality across expanding metropolitan clusters. Civic planners increasingly recognize that building wider highways alone rarely solves peak-hour congestion, because induced vehicular demand rapidly fills newly added lanes. Instead, integrated urban mobility prioritizes dedicated bus rapid transit corridors, high-frequency metro rail networks, shaded pedestrian walkways, and safe cycling tracks linking residential neighborhoods to commercial hubs. Complementing cleaner transit, sponge-city engineering uses permeable pavements, restored urban wetlands, and rooftop rainwater harvesting to absorb intense monsoon cloudbursts and recharge depleted aquifers. Waste segregation at the household level converts organic refuse into city compost and compressed biogas, reducing landfill methane emissions while supporting peri-urban agriculture. Municipal finance reforms, transparent environmental audits, and active resident welfare participation together transform sustainability blueprints into everyday civic habits. When clean air, reliable transit, and flood resilience improve simultaneously, cities become healthier, more productive, and far more equitable places for every working family. Secretariat officers drafting policy notes on municipal grants must verify numerical figures carefully, maintain uniform formatting standards, and complete lengthy official passages without losing concentration or introducing typographical slips during timed skill evaluations. Moreover, cross-departmental coordination between transport authorities, storm-water drainage engineers, and urban forestry divisions ensures that climate adaptation budgets deliver lasting ecological benefits without inflating recurring maintenance liabilities. Disciplined keyboard execution allows public administrators to document field inspections, procurement schedules, and statutory compliance reports accurately before strict submission deadlines close.',
  },
];

export interface DestTypingMetrics {
  keyDepressions: number;
  targetKeystrokes: number;
  progressPercent: number;
  correctChars: number;
  errorCount: number;
  accuracy: number;
  grossWpm: number;
  netWpm: number;
  errorPercentage: number;
  qualified: boolean;
}

export function computeDestTypingMetrics(
  targetText: string,
  typedText: string,
  elapsedSec: number
): DestTypingMetrics {
  const keyDepressions = typedText.length;
  const targetKeystrokes = DEST_TARGET_KEYSTROKES;
  const clampedElapsed = Math.max(1, elapsedSec);
  const minutes = clampedElapsed / 60;

  let correctChars = 0;
  let errorCount = 0;
  for (let i = 0; i < typedText.length; i += 1) {
    if (i < targetText.length && typedText[i] === targetText[i]) {
      correctChars += 1;
    } else {
      errorCount += 1;
    }
  }

  const accuracy =
    keyDepressions > 0 ? Math.round((correctChars / keyDepressions) * 1000) / 10 : 100;
  const errorPercentage =
    keyDepressions > 0 ? Math.round((errorCount / keyDepressions) * 1000) / 10 : 0;
  const progressPercent = Math.min(
    100,
    Math.round((keyDepressions / targetKeystrokes) * 1000) / 10
  );

  // Standard 5 keystrokes = 1 word
  const grossWpm = Math.round((keyDepressions / 5 / minutes) * 10) / 10;
  const netWords = Math.max(0, keyDepressions / 5 - errorCount);
  const netWpm = Math.round((netWords / minutes) * 10) / 10;

  const qualified = keyDepressions >= targetKeystrokes && errorPercentage <= 5;

  return {
    keyDepressions,
    targetKeystrokes,
    progressPercent,
    correctChars,
    errorCount,
    accuracy,
    grossWpm,
    netWpm,
    errorPercentage,
    qualified,
  };
}

export interface ComputerQuizQuestion {
  id: string;
  topic: string;
  question: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  explanation: string;
}

export const COMPUTER_KNOWLEDGE_QUESTIONS: ComputerQuizQuestion[] = [
  {
    id: 'comp_01',
    topic: 'Computer Architecture',
    question: 'Which memory sits closest to the CPU execution core and offers the fastest access speed?',
    options: ['CPU Registers', 'SSD Flash', 'DDR4 RAM', 'Optical Disk'],
    correctIndex: 0,
    explanation: 'CPU Registers are inside the processor and have sub-nanosecond access speed, faster than L1/L2/L3 cache and RAM.',
  },
  {
    id: 'comp_02',
    topic: 'Memory Units',
    question: 'One Nibble in digital computer architecture is strictly equal to how many bits?',
    options: ['2 bits', '4 bits', '8 bits', '16 bits'],
    correctIndex: 1,
    explanation: '1 Nibble = 4 bits (half a Byte), while 1 Byte = 8 bits.',
  },
  {
    id: 'comp_03',
    topic: 'MS Excel',
    question: 'In MS Excel, which keyboard shortcut inserts the current system date into the active cell?',
    options: ['Ctrl + ;', 'Ctrl + Shift + ;', 'Alt + D', 'Ctrl + F5'],
    correctIndex: 0,
    explanation: 'Ctrl + ; inserts the current date, whereas Ctrl + Shift + ; inserts the current time.',
  },
  {
    id: 'comp_04',
    topic: 'Networking (OSI)',
    question: 'At which layer of the OSI reference model does an IP Router primarily operate?',
    options: ['Physical Layer', 'Data Link Layer', 'Network Layer', 'Transport Layer'],
    correctIndex: 2,
    explanation: 'Routers examine logical IP addresses and perform packet forwarding at Layer 3 (Network Layer).',
  },
  {
    id: 'comp_05',
    topic: 'Protocols & Ports',
    question: 'Which default TCP port number is reserved for secure HTTPS web traffic?',
    options: ['21', '25', '80', '443'],
    correctIndex: 3,
    explanation: 'HTTPS uses port 443 (HTTP uses 80, FTP uses 21, SMTP uses 25).',
  },
  {
    id: 'comp_06',
    topic: 'Operating Systems',
    question: 'Which program runs immediately when a computer powers on to perform POST and load the OS kernel?',
    options: ['Compiler', 'BIOS / UEFI Firmware', 'Task Scheduler', 'Device Driver'],
    correctIndex: 1,
    explanation: 'BIOS/UEFI stored in non-volatile ROM runs Power-On Self Test (POST) and triggers the bootloader.',
  },
  {
    id: 'comp_07',
    topic: 'MS Word',
    question: 'In MS Word, pressing Ctrl + H opens which dialog box?',
    options: ['Header & Footer', 'Hyperlink', 'Find and Replace', 'History'],
    correctIndex: 2,
    explanation: 'Ctrl + F opens Find, whereas Ctrl + H opens the Replace tab of Find and Replace.',
  },
  {
    id: 'comp_08',
    topic: 'Cyber Security',
    question: 'What type of malware disguises itself as a legitimate useful application to trick users into installing it?',
    options: ['Trojan Horse', 'Firewall', 'VPN Tunnel', 'Checksum'],
    correctIndex: 0,
    explanation: 'A Trojan Horse poses as harmless software without self-replicating like a worm.',
  },
  {
    id: 'comp_09',
    topic: 'MS Excel Formulas',
    question: 'Which MS Excel function counts ONLY cells within a range that contain numeric values?',
    options: ['COUNTA()', 'COUNT()', 'COUNTBLANK()', 'SUMIF()'],
    correctIndex: 1,
    explanation: 'COUNT() counts numeric cells only; COUNTA() counts all non-empty cells.',
  },
  {
    id: 'comp_10',
    topic: 'Number System',
    question: 'What is the binary equivalent of decimal number 25?',
    options: ['11001', '10101', '11100', '10011'],
    correctIndex: 0,
    explanation: '25 = 16 + 8 + 1 = 1*2^4 + 1*2^3 + 0*2^2 + 0*2^1 + 1*2^0 = 11001.',
  },
  {
    id: 'comp_11',
    topic: 'Storage & Firmware',
    question: 'Which type of ROM can be erased and reprogrammed electrically without removing the chip?',
    options: ['PROM', 'EPROM (UV)', 'EEPROM', 'Mask ROM'],
    correctIndex: 2,
    explanation: 'EEPROM stands for Electrically Erasable Programmable Read-Only Memory (flash memory builds on it).',
  },
  {
    id: 'comp_12',
    topic: 'Internet & DNS',
    question: 'What is the primary function of DNS (Domain Name System) on the Internet?',
    options: [
      'Encrypting email attachments',
      'Translating human-readable domain names into IP addresses',
      'Compressing video streams',
      'Blocking unauthorized USB drives',
    ],
    correctIndex: 1,
    explanation: 'DNS acts like the phonebook of the Internet, resolving domain names (like ssc.gov.in) to IP addresses.',
  },
  {
    id: 'comp_13',
    topic: 'MS PowerPoint',
    question: 'In MS PowerPoint, which key starts the Slide Show directly from the very first slide?',
    options: ['F2', 'F5', 'Shift + F5', 'Alt + S'],
    correctIndex: 1,
    explanation: 'F5 starts from the first slide, while Shift + F5 starts from the currently selected slide.',
  },
  {
    id: 'comp_14',
    topic: 'Browser & Keyboard Shortcuts',
    question: 'In modern web browsers, which shortcut reopens the most recently closed browser tab?',
    options: ['Ctrl + Shift + T', 'Ctrl + W', 'Ctrl + Shift + N', 'Alt + Tab'],
    correctIndex: 0,
    explanation: 'Ctrl + Shift + T restores the last closed tab; Ctrl + W closes the current tab.',
  },
  {
    id: 'comp_15',
    topic: 'Data Communication',
    question: 'Which protocol guarantees reliable, ordered, error-checked delivery of byte streams between applications?',
    options: ['UDP', 'TCP', 'ICMP', 'ARP'],
    correctIndex: 1,
    explanation: 'TCP (Transmission Control Protocol) provides connection-oriented, acknowledged, ordered packet delivery.',
  },
  {
    id: 'comp_16',
    topic: 'MS Excel Cell Referencing',
    question: 'Which symbol locks a column or row in an MS Excel formula to make it an absolute reference (e.g., $A$1)?',
    options: ['#', '&', '$', '@'],
    correctIndex: 2,
    explanation: 'The dollar sign ($) fixes column and/or row references when copying formulas across cells.',
  },
  {
    id: 'comp_17',
    topic: 'Database Basics',
    question: 'In a relational database table, a column (or set of columns) that uniquely identifies every row without NULL values is called:',
    options: ['Foreign Key', 'Primary Key', 'Composite Alias', 'Check Index'],
    correctIndex: 1,
    explanation: 'A Primary Key uniquely identifies each record in a table and cannot contain NULL values.',
  },
  {
    id: 'comp_18',
    topic: 'Cyber Security',
    question: 'Sending fraudulent emails disguised as trusted banks or agencies to steal login credentials is known as:',
    options: ['Phishing', 'Defragmentation', 'Spooling', 'Multiplexing'],
    correctIndex: 0,
    explanation: 'Phishing uses deceptive messages or spoofed sites to harvest passwords, OTPs, or financial details.',
  },
  {
    id: 'comp_19',
    topic: 'MS Word Formatting',
    question: 'Which keyboard shortcut aligns selected paragraph text cleanly to BOTH left and right margins (Justify)?',
    options: ['Ctrl + E', 'Ctrl + J', 'Ctrl + R', 'Ctrl + L'],
    correctIndex: 1,
    explanation: 'Ctrl + J justifies text, Ctrl + E centers, Ctrl + L left-aligns, and Ctrl + R right-aligns.',
  },
  {
    id: 'comp_20',
    topic: 'Email Protocols',
    question: 'Which standard protocol is primarily used to SEND outgoing email messages from a client to a mail server?',
    options: ['IMAP', 'POP3', 'SMTP', 'SNMP'],
    correctIndex: 2,
    explanation: 'SMTP (Simple Mail Transfer Protocol) handles outgoing mail transmission; IMAP and POP3 retrieve incoming mail.',
  },
];

export interface ComputerQuizOutcome {
  correctCount: number;
  wrongCount: number;
  unattemptedCount: number;
  score: number;
  maxScore: number;
  accuracy: number;
  qualifyingPassed: boolean;
}

export function scoreComputerQuiz(
  questions: ComputerQuizQuestion[],
  selectedById: Record<string, number>
): ComputerQuizOutcome {
  let correctCount = 0;
  let wrongCount = 0;
  let unattemptedCount = 0;

  for (const q of questions) {
    const pick = selectedById[q.id];
    if (pick === undefined || pick < 0 || pick > 3) {
      unattemptedCount += 1;
    } else if (pick === q.correctIndex) {
      correctCount += 1;
    } else {
      wrongCount += 1;
    }
  }

  // SSC CGL Tier-II Computer Knowledge Pattern: +3 / -1 (max 60, UR qualifying 18)
  const rawScore = correctCount * 3 - wrongCount * 1;
  const maxScore = questions.length * 3;
  const attempted = correctCount + wrongCount;
  const accuracy = attempted > 0 ? Math.round((correctCount / attempted) * 1000) / 10 : 0;

  return {
    correctCount,
    wrongCount,
    unattemptedCount,
    score: rawScore,
    maxScore,
    accuracy,
    qualifyingPassed: rawScore >= Math.round(maxScore * 0.3),
  };
}
