export default async function handler(req, res) {
  // POST 요청만 허용
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed',
    });
  }

  const { url } = req.body;

  // 환경 변수에서 API 키 가져오기
  const API_KEY = process.env.SAFE_BROWSING_API_KEY;

  // 키 없을 때 처리
  if (!API_KEY) {
    return res.status(500).json({
      error: 'API key not configured',
    });
  }

  try {
    // Google Safe Browsing API 요청
    const response = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client: {
            clientId: 'phishguard',
            clientVersion: '1.0',
          },
          threatInfo: {
            threatTypes: [
              'MALWARE',
              'SOCIAL_ENGINEERING',
              'UNWANTED_SOFTWARE',
            ],
            platformTypes: ['ANY_PLATFORM'],
            threatEntryTypes: ['URL'],
            threatEntries: [{ url }],
          },
        }),
      }
    );

    const data = await response.json();

    return res.status(200).json(data);

  } catch (error) {
    console.error('Safe Browsing API Error:', error);

    return res.status(500).json({
      error: 'Failed to fetch from Google',
    });
  }
}
