# n8n workflow-ები Gokski-სთვის

## word-of-the-day.json — დღის სიტყვა
ყოველ დილით 9:00-ზე (თბილისის დროით) Telegram-ში აგზავნის ერთ სიტყვას: თარგმანი, მაგალითი, ფრაზა, რჩევა ქართულად და ხმა.

1. n8n → **Workflows → ⋯ → Import from File** → ეს ფაილი.
2. **პარამეტრები** კვანძში `chat_id` შეცვალე შენი Telegram ID-ით (@userinfobot გეტყვის). `level` — A1/A2/B1/B2.
3. **სიტყვის შექმნა** და **ხმის შექმნა** → Credential: **OpenAI** (API key).
4. **Telegram-ში გაგზავნა** → Credential: **Telegram** (@gokskibot-ის ტოკენი).
5. **Execute workflow** — შეამოწმე. მერე ზემოთ **Active** ჩართე.
