export type Side = {
  label: string;
  text: string;
};

export type Chapter = {
  id: string;
  label: string;
  body: string;
  sides: Side[];
  receiptLabel: string;
  receipt: string;
};

export const chapters: Chapter[] = [
  {
    id: "0",
    label: "01 Greet",
    body: "Ada Marin's agent arrives and names her. Silvector greets it and opens a record.",
    sides: [
      { label: "Customer", text: "You see the shop greet the agent you sent." },
      { label: "Agent", text: "The shop greets you as Ada Marin's agent." },
      { label: "Seller", text: "A customer's agent is at the door." },
      { label: "Silvector", text: "It named who sent it, so it gets a hearing." },
    ],
    receiptLabel: "Receipt · Agent",
    receipt: "A shopping agent that named the person it acts for.",
  },
  {
    id: "1",
    label: "02 Assess",
    body: "The agent is new to this shop. The requests look like one errand, not a crawl. The band is moderate. A band is not a score.",
    sides: [
      { label: "Customer", text: "You see the check, not a number." },
      { label: "Agent", text: "This shop has not seen you before." },
      { label: "Seller", text: "The agent is new here." },
      { label: "Silvector", text: "Errand-shaped. Band: moderate." },
    ],
    receiptLabel: "Receipt · Risk",
    receipt: "New to this shop. Band: moderate. Not a score.",
  },
  {
    id: "2",
    label: "03 Verify",
    body: "Ada Marin allowed a cart. She did not allow payment. The cart can fill. Payment waits for her.",
    sides: [
      { label: "Customer", text: "It can shop. It cannot pay until you confirm." },
      { label: "Agent", text: "You may fill a cart. You may not pay." },
      {
        label: "Seller",
        text: "The customer's limit is checked before anything is paid.",
      },
      { label: "Silvector", text: "Cart allowed. Payment held." },
    ],
    receiptLabel: "Receipt · Delegation",
    receipt: "Cart allowed. Payment waits for Ada Marin.",
  },
  {
    id: "3",
    label: "04 Permit / Step up",
    body: "Busy hours: the agent is slowed, and it still gets an answer. Full cart: Ada Marin confirms by text or by a click. That is a step up. Quiet hours: the same visit is permitted.",
    sides: [
      { label: "Customer", text: "You confirm when the cart needs you." },
      { label: "Agent", text: "You wait when the purchase needs the person." },
      { label: "Seller", text: "Pace the agent, or ask the customer to confirm." },
      {
        label: "Silvector",
        text: "The answer changes with the shop. None of the answers is a silent refusal.",
      },
    ],
    receiptLabel: "Receipt · Outcome",
    receipt: "The visit is underway. The shop's answer comes next.",
  },
  {
    id: "4",
    label: "05 Log",
    body: "Every step above is written into one signed receipt.",
    sides: [
      { label: "Customer", text: "You can read what the agent did." },
      { label: "Agent", text: "The same receipt comes back to you." },
      { label: "Seller", text: "You can keep the receipt." },
      { label: "Silvector", text: "One record. Three readers." },
    ],
    receiptLabel: "Receipt · Evidence",
    receipt: "The shop, the person, and the agent can check the same receipt.",
  },
];

export type FilmPage = {
  slug: string;
  title: string;
  kicker: string;
  lede: string;
  seconds: number;
  file: string;
  aria: string;
  notices: string[];
  previous?: { slug: string; label: string };
  next?: { slug: string; label: string };
};

export const films: FilmPage[] = [
  {
    slug: "customer",
    title: "The customer's view",
    kicker: "Perspectives · 1 of 4",
    lede: "You ask your agent to buy a quiet air purifier. This film is that errand from your side: the limits you set, the tap when a price goes over them, and the receipt at the end.",
    seconds: 77,
    file: "customer",
    aria: "Film: the customer's view. 77 seconds, captioned.",
    notices: [
      "Before it leaves, you sign a delegation: what it may do, where, and how much it may spend.",
      "At the door, Silvector greets your agent and lets it in within those limits.",
      "The quietest purifier is $349, over your limit. Nothing happens until you confirm.",
    ],
    next: { slug: "agent", label: "Next: The agent's view" },
  },
  {
    slug: "agent",
    title: "The agent's view",
    kicker: "Perspectives · 2 of 4",
    lede: "The same visit, told by the shopping agent. It arrives with a task and a delegation its person signed.",
    seconds: 83,
    file: "agent",
    aria: "Film: the agent's view. 83 seconds, captioned.",
    notices: [
      "Silvector asks who the agent is and who sent it, then checks the signed delegation.",
      "When it reads too fast, it is slowed down, not thrown out.",
      "The price is over the limit, so the person confirms first. Every step goes on the receipt.",
    ],
    previous: { slug: "customer", label: "Previous: The customer's view" },
    next: { slug: "seller", label: "Next: The seller's view" },
  },
  {
    slug: "seller",
    title: "The seller's view",
    kicker: "Perspectives · 3 of 4",
    lede: "The same visit from the shop. Some agents buy for people. Some scrape prices. From outside they can look alike.",
    seconds: 71,
    file: "seller",
    aria: "Film: the seller's view. 71 seconds, captioned.",
    notices: [
      "Silvector starts by watching. It shows what it would do and blocks nothing.",
      "When the shop switches to enforce, only the rules the shop approved take effect.",
      "A shopping agent gets through within its limits. One with a copied delegation is blocked, and that decision is written down.",
    ],
    previous: { slug: "agent", label: "Previous: The agent's view" },
    next: { slug: "silvector", label: "Next: Silvector's view" },
  },
  {
    slug: "silvector",
    title: "Silvector's view",
    kicker: "Perspectives · 4 of 4",
    lede: "Silvector stands at the door. At each step of the same visit: what it noticed, what it decided, and why.",
    seconds: 80,
    file: "silvector-view",
    aria: "Film: Silvector's view. 80 seconds, captioned.",
    notices: [
      "It greets the agent, reads the signals, and gives a band. A band is not a score.",
      "The cart is allowed. Payment waits for the person.",
      "Every step is a signed receipt. Not another protocol for the agent to adopt.",
    ],
    previous: { slug: "seller", label: "Previous: The seller's view" },
  },
];

export const filmCards = [
  { slug: "customer", title: "The customer", seconds: 77, file: "customer" },
  { slug: "agent", title: "The agent", seconds: 83, file: "agent" },
  { slug: "seller", title: "The seller", seconds: 71, file: "seller" },
  { slug: "silvector", title: "Silvector", seconds: 80, file: "silvector-view" },
] as const;

export const diagrams = [
  {
    src: "/media/diagrams/human.svg",
    alt: "Customer storyboard: greet, confirm, receipt.",
    caption: "Customer",
  },
  {
    src: "/media/diagrams/agent.svg",
    alt: "Agent storyboard: door, check, cart.",
    caption: "Agent",
  },
  {
    src: "/media/diagrams/seller.svg",
    alt: "Seller storyboard: shop, hours, receipt.",
    caption: "Seller",
  },
  {
    src: "/media/diagrams/silvector.svg",
    alt: "Silvector storyboard: noticed, decided, why written down.",
    caption: "Silvector",
  },
] as const;
