# LexPH CLI

## Setup

1. `cd lexph-cli`
2. `npm install`
3. `cp .env.example .env`
4. Edit `.env` with API keys
5. `npm start`

## API Keys Needed

```
TAVILY_API_KEY=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  # Provided
GROQ_API_KEY=  # https://console.groq.com/keys
GEMINI_API_KEY_1=  # https://makersuite.google.com/app/apikey
GEMINI_API_KEY_2=  # Optional
GEMINI_API_KEY_3=  # Optional
```

## Usage

Interactive CLI - enter legal queries like:
```
illegal dismissal due process
RA 11232 compliance
```

**Flow:**
1. Tavily search (legal context)
2. Groq Llama3 analysis
3. Gemini fallback if needed
4. Cached 1hr

## Commands
- `npm start` - run CLI
- `npm run dev` - nodemon watch
