# daily-mindset-builder-3
A personalized motivation, confidence, and wellness app that matches daily quotes to each user’s mood and personality.

## Run With OpenAI Features

The Mindset Coach page now uses backend API routes powered by the OpenAI Responses API.

1. Install dependencies:
	npm install
2. Copy environment template and add your key:
	cp .env.example .env
3. Set your OpenAI key in `.env`:
	OPENAI_API_KEY=your_key_here
4. Start the server:
	npm start
5. Open the app:
	http://localhost:3000/mindset-coach.html

### API Routes

- `POST /api/analyze-journal`
- `POST /api/goal-coach`
- `POST /api/weekly-report`
- `POST /api/personal-coach`

### Vercel Deployment Checklist

To run AI features on Vercel production:

1. Ensure this repository includes the `api/` folder with serverless routes.
2. In Vercel Project Settings -> Environment Variables, set:
	`OPENAI_API_KEY`
3. Redeploy after adding/changing the environment variable.
4. Verify health route on production:
	`https://<your-vercel-domain>/api/health`

If the key is missing, endpoints return:
`{"error":"OPENAI_API_KEY is not configured on the server.","code":"missing_api_key"}`

### AI Request Limits By Plan

- Free: 3 per day
- Standard: 30 per day
- Premium: 100 per day
- Pro: unlimited
