import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route for Google Safe Browsing
  app.post("/api/check-safe-browsing", async (req, res) => {
    const { url } = req.body;
    const API_KEY = process.env.SAFE_BROWSING_API_KEY;

    // API Key가 없는 경우도 처리 (사용자가 아직 설정하지 않았을 수 있음)
    if (!API_KEY || API_KEY.trim() === "") {
      console.warn("SAFE_BROWSING_API_KEY is missing in environment variables.");
      return res.status(200).json({ 
        error: "API_KEY_MISSING",
        message: "Google Safe Browsing API 키가 설정되지 않았습니다." 
      });
    }

    try {
      const response = await fetch(
        `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${API_KEY}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client: {
              clientId: "phishing-detector",
              clientVersion: "1.0",
            },
            threatInfo: {
              threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE"],
              platformTypes: ["ANY_PLATFORM"],
              threatEntryTypes: ["URL"],
              threatEntries: [{ url }],
            },
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("Google API Error Response:", errorData);
        return res.status(response.status).json({ 
          error: "GOOGLE_API_ERROR", 
          details: errorData 
        });
      }

      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("Safe Browsing API Fetch Error:", error);
      res.status(500).json({ error: "FETCH_FAILED", message: "Google API 호출 중 네트워크 오류가 발생했습니다." });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
