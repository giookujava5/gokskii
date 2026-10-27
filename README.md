# Gokski — ინგლისური ქართულად (A1 → B2)

100 ნაწილი, 300 გაკვეთილი, სალაპარაკო სავარჯიშო. Telegram Mini App და ვებ-აპი.

## საქაღალდეების სტრუქტურა
```
wrangler.jsonc        ← Cloudflare Worker-ის პარამეტრები
src/worker.js         ← /api/stt — ხმის ტექსტად გადაქცევა (გამოთქმის შემოწმება)
public/index.html     ← აპი
public/units/a1.js    ← ნაწილები 11–20 (A1)
public/units/a2.js    ← ნაწილები 21–45 (A2)
public/units/b1.js    ← ნაწილები 46–75 (B1)
public/units/b2.js    ← ნაწილები 76–100 (B2)
```
ნაწილები 1–10 თავად `index.html`-შია.

## GitHub-ზე განახლება
1. რეპოზიტორიიდან წაშალე ძველი `index.html` (ფაილი → ⋯ → **Delete file** → Commit).
2. **Add file → Upload files** → გადაათრიე ამ საქაღალდის **შიგთავსი** (`wrangler.jsonc`, `src`, `public`, `README.md`) → **Commit changes**.
3. Cloudflare ავტომატურად ააწყობს და გაუშვებს (1–2 წუთი).

## გამოთქმის შემოწმების ჩართვა
Cloudflare → **Workers & Pages → gokskii → Settings → Variables and Secrets → Add**:

| სახელი | ტიპი | მნიშვნელობა |
|---|---|---|
| `OPENAI_API_KEY` | Secret | შენი OpenAI გასაღები (გირჩევ — ყველაზე ზუსტია) |
| `TELEGRAM_BOT_TOKEN` | Secret | @gokskibot-ის ტოკენი (BotFather-იდან) — სხვები ვერ გამოიყენებენ შენს ლიმიტს |

OpenAI გასაღების გარეშე Cloudflare-ის უფასო Workers AI იმუშავებს (დღიური ლიმიტით).

## პროგრესი
ინახება Telegram-ის ანგარიშზე. ახალი ნაწილები ყოველთვის **ბოლოში** ემატება, ამიტომ პროგრესი არასდროს იკარგება.
