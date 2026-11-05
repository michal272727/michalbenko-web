# Meta funnel A/B/C: Apps Script

1. script.google.com (účet michalbenko3@gmail.com) → nový projekt → vlož `Code.gs`.
2. Spusti `setup()` raz (povoľ prístupy), v logu skopíruj SECRET.
3. Deploy → New deployment → Web app → Execute as: Me, Access: Anyone → skopíruj `/exec` URL.
4. Zapier: spúšťač Facebook Lead Ads (formulár A/B/C) + 1 akcia Webhooks by Zapier → POST (Payload type JSON, Data: všetky polia leadu) na
   `<exec URL>?key=<SECRET>&f=A` (pre B `f=B`, pre C `f=C`).
Follow-upy (4. a 10. deň) a uzavretie (14. deň) beží hodinový časovač `tick()`; stav v Sheete určuje, či sa pošlú.
Nie je overené s reálnym leadom: otestuj cez Meta Lead Ads Testing.
