import { useState, useEffect, useMemo, useRef } from 'react';
import { 
  ShieldCheck, 
  ShieldAlert, 
  ShieldQuestion, 
  Camera, 
  BookOpen, 
  ArrowLeft, 
  Search, 
  ExternalLink,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Info,
  Scan,
  MessageSquare
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Html5Qrcode } from 'html5-qrcode';

// --- Types & Constants ---

type Screen = 'MAIN' | 'QR_SCAN' | 'RESULT' | 'TIPS' | 'TIP_DETAIL';

interface AnalysisFlag {
  id: string;
  label: string;
  isSafe: boolean;
  description: string;
}

interface AnalysisResult {
  type: 'URL' | 'PHONE';
  input: string;
  score: number; // 0 to 100
  reasons: string[];
  recommendations: string[];
  flags: AnalysisFlag[]; // Kept for UI compatibility
  safeBrowsingError?: boolean;
  safeBrowsingMatches?: any[];
  messageThreats?: string[];
  detectedKeywords?: string[];
}

interface TipCategory {
  id: string;
  icon: string;
  title: string;
  description: string;
  details: string[];
}

const TIP_CATEGORIES: TipCategory[] = [
  {
    id: 'delivery',
    icon: '📦',
    title: '택배 사칭 피싱 예방',
    description: '주소불명, 배송지 오류 등의 문자를 주의하세요.',
    details: [
      '택배사는 절대로 고객에게 개인정보나 계좌번호를 문자로 요구하지 않습니다.',
      '문자에 포함된 링크는 클릭하지 말고, 공식 앱이나 홈페이지에서 배송 상태를 확인하세요.',
      '출처가 불분명한 번호로 온 문자는 일단 의심하십시오.'
    ]
  },
  {
    id: 'finance',
    icon: '🏦',
    title: '금융기관 사칭 피싱 예방',
    description: '저금리 대출, 카드 부정 사용 알림을 주의하세요.',
    details: [
      '은행 직원은 절대로 전화를 통해 OTP 번호나 비밀번호를 묻지 않습니다.',
      '대출 권유 문자에 포함된 상담 링크를 클릭하는 것은 매우 위험합니다.',
      '카드 결제 문자가 의심스러울 경우 문자 내 번호가 아닌 카드사 공식 번호로 전화하세요.'
    ]
  },
  {
    id: 'government',
    icon: '⚖️',
    title: '정부기관 사칭 피싱 예방',
    description: '검찰, 경찰, 금감원 사칭 협박에 속지 마세요.',
    details: [
      '수사기관은 절대로 카카오톡이나 문자로 공문서를 보내지 않습니다.',
      '비대면 조사를 명목으로 특정 앱 설치를 요구한다면 100% 피싱입니다.',
      '정부기관은 절대로 안전계좌로의 송금을 요구하지 않습니다.'
    ]
  },
  {
    id: 'others',
    icon: '💬',
    title: '지인 사칭 및 기타 예방',
    description: '가족, 친구를 사칭한 급전 요구에 주의하세요.',
    details: [
      '지인이 급하게 돈을 빌려달라고 한다면 반드시 직접 통화하여 신원을 확인하세요.',
      '청첩장, 부고장 등의 문자로 위장한 APK 설치 유도에 주의하세요.',
      '휴대폰 고장 등을 핑계로 원격 제어 앱 설치를 권유한다면 거절하십시오.'
    ]
  }
];

// --- Detection Logic ---

/**
 * Google Safe Browsing API 연동 사이트 조회
 */
const checkSafeBrowsing = async (url: string) => {
  try {
    const response = await fetch('/api/check-safe-browsing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    
    const data = await response.json();
    
    // API 키 누락이나 기타 백엔드에서 정의한 에러 처리
    if (data.error) {
      console.warn("Safe Browsing Check skipped or failed:", data.error, data.message);
      return 'ERROR';
    }
    
    return data.matches || null;
  } catch (error) {
    console.error("Safe Browsing API network request failed:", error);
    return 'ERROR';
  }
};

/**
 * 텍스트에서 URL들을 추출하는 함수
 */
const extractUrlsFromText = (text: string): string[] => {
  // http, https, www 로 시작하거나, 주요 TLD를 포함하는 도메인 추출
  const urlRegex = /(?:https?:\/\/|www\.)[^\s]+|[a-zA-Z0-9.-]+\.(?:com|net|org|kr|io|xyz|top|click|monster|zip|biz|info|site)(?:\/[^\s]*)?/gi;
  const matches = text.match(urlRegex);
  
  if (!matches) return [];
  
  // 끝에 붙은 구두점 제거
  return matches.map(url => url.trim().replace(/[.,!?;:]+$/, ''));
};

/**
 * URL 분석 함수 (10가지 규칙 기반)
 */
const analyzeUrl = (input: string): Omit<AnalysisResult, 'flags'> & { score: number, reasons: string[] } => {
  let url = input.trim().toLowerCase();
  
  // URL 전처리: 프로토콜이 없으면 https:// 추가
  if (!/^https?:\/\//.test(url)) {
    url = 'https://' + url;
  }

  const reasons: string[] = [];
  let safetyScore = 100;

  // [A] HTTPS 여부 검사
  if (!url.startsWith('https://')) {
    safetyScore -= 20;
    reasons.push("보안 연결(HTTPS)이 사용되지 않았습니다.");
  }

  // [B] 단축 URL 탐지
  const shorteners = ['bit.ly', 'tinyurl.com', 'goo.gl', 't.co', 'is.gd'];
  if (shorteners.some(s => url.includes(s))) {
    safetyScore -= 25;
    reasons.push("단축 URL이 사용되었습니다.");
  }

  // [C] 유명 사이트 사칭 탐지
  const spoofPatterns = ['paypa1', 'g00gle', 'faceb00k', 'micr0soft'];
  if (spoofPatterns.some(p => url.includes(p))) {
    safetyScore -= 40;
    reasons.push("유명 사이트 사칭 가능성이 있습니다.");
  }

  // [D] 브랜드명 + 이상 도메인 탐지
  const brands = ['paypal', 'google', 'facebook', 'kakao', 'naver', 'apple'];
  const hasBrand = brands.some(b => url.includes(b));
  if (hasBrand && !url.includes('.com')) {
    safetyScore -= 30;
    reasons.push("정상 브랜드 도메인 형식과 다릅니다.");
  }

  // [E] 위험 키워드 탐지
  const dangerKeywords = ['login', 'verify', 'urgent', 'account', 'security', 'bank', 'payment', 'confirm', 'update'];
  dangerKeywords.forEach(k => {
    if (url.includes(k)) {
      safetyScore -= 10;
      reasons.push(`위험 키워드(${k})가 포함되어 있습니다.`);
    }
  });

  // [F] 숫자 과다 탐지
  const digitCount = (url.match(/\d/g) || []).length;
  if (digitCount >= 5) {
    safetyScore -= 15;
    reasons.push("비정상적으로 많은 숫자가 포함되어 있습니다.");
  }

  // [G] 특수문자 과다 탐지
  const specialCharCount = (url.match(/[-_]/g) || []).length;
  if (specialCharCount >= 4) {
    safetyScore -= 10;
    reasons.push("특수문자가 과도하게 사용되었습니다.");
  }

  // [H] IP 주소 URL 탐지
  const ipPattern = /(\d{1,3}\.){3}\d{1,3}/;
  if (ipPattern.test(url)) {
    safetyScore -= 35;
    reasons.push("IP 주소 기반 URL이 사용되었습니다.");
  }

  // [I] 의심 TLD 탐지
  const suspiciousTlds = ['.xyz', '.top', '.click', '.monster', '.zip'];
  if (suspiciousTlds.some(tld => url.endsWith(tld) || url.includes(tld + '/'))) {
    safetyScore -= 20;
    reasons.push("의심스러운 최상위 도메인(TLD)이 사용되었습니다.");
  }

  // [J] URL 길이 검사
  if (url.length > 80) {
    safetyScore -= 10;
    reasons.push("URL 길이가 비정상적으로 깁니다.");
  }

  return {
    type: 'URL',
    input: url,
    score: Math.max(safetyScore, 0),
    reasons,
    recommendations: []
  };
};

/**
 * 전화번호 위험 분석 함수
 */
const analyzePhone = (input: string): AnalysisResult | null => {
  const phone = input.trim();
  // 전화번호 패턴 확인 (숫자, -, +, 공백 포함)
  if (!/^[\d\-\+\s]+$/.test(phone) || phone.length < 8) return null;

  const reasons: string[] = [];
  let safetyScore = 100;

  // 070 번호 여부
  if (phone.startsWith('070')) {
    safetyScore -= 25;
    reasons.push('인터넷 전화(070) 번호입니다.');
  }

  // 국제번호 (+82 제외 해외번호)
  if (phone.startsWith('+') && !phone.startsWith('+82')) {
    safetyScore -= 30;
    reasons.push('해외 발신 번호일 가능성이 있습니다.');
  }

  // 숫자 길이 이상
  const digits = phone.replace(/\D/g, '');
  if (digits.length > 13 || digits.length < 9) {
    safetyScore -= 20;
    reasons.push('전화번호 형식이 비정상적입니다.');
  }

  // 특수문자 과다 (하이픈 제외)
  const specialChars = (phone.match(/[^\d\s-]/g) || []).length;
  if (specialChars > 3) {
    safetyScore -= 10;
    reasons.push('번호에 특수문자가 비정상적으로 많이 포함되어 있습니다.');
  }

  return {
    type: 'PHONE',
    input: phone,
    score: Math.max(safetyScore, 0),
    reasons,
    recommendations: getRecommendations(safetyScore),
    flags: []
  };
};

/**
 * 점수에 따른 권장 행동 반환 (80-100: 안전, 40-79: 주의, 0-39: 위험)
 */
const getRecommendations = (score: number): string[] => {
  if (score < 40) {
    return [
      "링크를 클릭하지 마세요.",
      "개인정보 입력을 피하세요.",
      "공식 사이트 주소를 직접 입력하세요."
    ];
  } else if (score < 80) {
    return [
      "사이트 주소를 다시 확인하세요.",
      "로그인 전 HTTPS 여부를 확인하세요."
    ];
  } else {
    return [
      "현재 명확한 위험 요소는 발견되지 않았습니다."
    ];
  }
};

/**
 * 문자 메시지 내용 피싱 패턴 분석 함수
 */
const analyzeMessageContent = (text: string): { scoreReduction: number, threats: string[], keywords: string[] } => {
  let scoreReduction = 0;
  const threats: string[] = [];
  const detectedKeywords: string[] = [];

  const checkPattern = (keywords: string[], weight: number, reason: string) => {
    const found: string[] = [];
    keywords.forEach(k => {
      if (text.includes(k)) {
        found.push(k);
      }
    });
    if (found.length > 0) {
      scoreReduction += weight;
      threats.push(reason);
      detectedKeywords.push(...found);
      return true;
    }
    return false;
  };

  // [긴급성 유도]
  checkPattern(['긴급', '즉시', '제한', '정지 예정', '만료', '인증 필요', '본인 확인', '보안 확인'], 20, '긴급한 행동을 유도하는 표현이 포함되어 있습니다.');

  // [금융기관 사칭]
  checkPattern(['국민은행', '신한은행', '농협', '카카오뱅크', '금융감독원', '카드사', '계좌'], 25, '금융기관을 사칭하여 신뢰를 유도하는 정황이 있습니다.');

  // [정부기관 사칭]
  checkPattern(['검찰', '경찰', '국세청', '정부지원금'], 30, '정부기관이나 공적 지원을 사칭하고 있습니다.');

  // [개인정보 요구]
  checkPattern(['비밀번호 입력', '인증번호 입력', 'OTP', '계좌 확인'], 30, '비밀번호나 인증번호 등 민감한 정보를 요구하고 있습니다.');

  // [택배/결제 사칭]
  checkPattern(['배송 오류', '주소 확인', '결제 실패', '미납금'], 15, '택배 배송이나 결제 관련 문제를 사칭하고 있습니다.');

  // [앱 설치 유도]
  checkPattern(['APK 설치', '앱 다운로드', '원격제어 앱'], 35, '의심스러운 외부 앱 설치나 원격 제어를 유도하고 있습니다.');

  // [문맥 조합 분석]
  const contextPatterns = [
    { words: ['계정', '인증'], reason: '계정 인증을 유도하는 사칭 패턴입니다.' },
    { words: ['보안', '확인'], reason: '보안 확인을 빌미로 클릭을 유도하고 있습니다.' },
    { words: ['즉시', '확인'], reason: '시간적 압박을 주어 판단을 흐리게 합니다.' },
    { words: ['24시간', '이내'], reason: '제한 시간을 설정하여 긴급 상황을 연출합니다.' }
  ];

  contextPatterns.forEach(p => {
    if (p.words.every(w => text.includes(w))) {
      scoreReduction += 10;
      threats.push(p.reason);
    }
  });

  return {
    scoreReduction,
    threats: Array.from(new Set(threats)), // 중복 제거
    keywords: Array.from(new Set(detectedKeywords))
  };
};

/**
 * QR 분석 함수
 */
const analyzeQR = async (decodedText: string): Promise<AnalysisResult | null> => {
  return performAnalysis(decodedText);
};

/**
 * 통합 분석 실행 (비동기)
 */
const performAnalysis = async (input: string): Promise<AnalysisResult | null> => {
  const trimmedInput = input.trim();
  if (!trimmedInput) return null;
  
  // 1. 메시지 내부 URL 추출
  const extractedUrls = extractUrlsFromText(trimmedInput);
  
  // 2. 메시지 내용 피싱 패턴 분석
  const messageAnalysis = analyzeMessageContent(trimmedInput);
  
  let finalResult: AnalysisResult | null = null;

  if (extractedUrls.length > 0) {
    // URL이 포함된 경우
    const targetUrl = extractedUrls[0];
    
    // URL 유효성 검사
    try {
      let testUrl = targetUrl.toLowerCase();
      if (!/^https?:\/\//.test(testUrl)) {
        testUrl = 'https://' + testUrl;
      }
      new URL(testUrl);
    } catch {
      if (extractedUrls.length === 1 && !/^[\d\-\+\s]+$/.test(trimmedInput)) {
        // URL이 추출되었으나 유효하지 않은 형식이고, 다른 분석 대상도 아니면 무시
      }
    }

    const baseResult = analyzeUrl(targetUrl);
    let finalScore = baseResult.score;
    const finalReasons = [...baseResult.reasons];
    let safeBrowsingError = false;
    let safeBrowsingMatches: any[] = [];
    
    // Google Safe Browsing API 체크
    const matches = await checkSafeBrowsing(baseResult.input);
    
    if (matches === 'ERROR') {
      safeBrowsingError = true;
    } else if (matches && matches.length > 0) {
      safeBrowsingMatches = matches;
      finalScore -= 50;
      const types = matches.map((m: any) => m.threatType).join(", ");
      finalReasons.push(`Google 보안 데이터베이스에서 위험 사이트로 탐지되었습니다. (위험 유형: ${types})`);
    }

    // 메시지 내용 분석 결과 반영
    if (messageAnalysis.scoreReduction > 0) {
      finalScore -= messageAnalysis.scoreReduction;
      finalReasons.push(...messageAnalysis.threats);
    }

    const clampedScore = Math.max(finalScore, 0);

    finalResult = {
      ...baseResult,
      score: clampedScore,
      reasons: Array.from(new Set(finalReasons)),
      recommendations: getRecommendations(clampedScore),
      flags: [],
      safeBrowsingError,
      safeBrowsingMatches,
      messageThreats: messageAnalysis.threats,
      detectedKeywords: messageAnalysis.keywords
    };
  } else if (/^[\d\-\+\s]+$/.test(trimmedInput) && trimmedInput.length >= 8) {
    // 3. 전화번호 분석 (URL이 없는 경우)
    const phoneResult = analyzePhone(trimmedInput);
    if (phoneResult) {
      finalResult = phoneResult;
    }
  } else if (messageAnalysis.threats.length > 0) {
    // 4. URL은 없지만 메시지 내용이 의심스러운 경우
    const score = Math.max(100 - messageAnalysis.scoreReduction, 0);
    finalResult = {
      type: 'URL', // 편의상 URL 타입으로 유지 (UI 구조상)
      input: trimmedInput,
      score: score,
      reasons: messageAnalysis.threats,
      recommendations: getRecommendations(score),
      flags: [],
      messageThreats: messageAnalysis.threats,
      detectedKeywords: messageAnalysis.keywords
    };
  }

  return finalResult;
};

// --- Components ---

const RiskGauge = ({ score }: { score: number }) => {
  const getStatus = () => {
    // 80-100: 안전, 40-79: 주의, 0-39: 위험
    if (score >= 80) return { label: '안전', color: 'text-green-600', bg: 'bg-green-100', border: 'border-green-600', icon: ShieldCheck };
    if (score >= 40) return { label: '주의', color: 'text-yellow-600', bg: 'bg-yellow-100', border: 'border-yellow-600', icon: ShieldQuestion };
    return { label: '위험', color: 'text-red-600', bg: 'bg-red-100', border: 'border-red-600', icon: ShieldAlert };
  };

  const status = getStatus();
  const Icon = status.icon;

  return (
    <div className="flex flex-col items-center">
      <div className={`relative w-40 h-40 flex items-center justify-center rounded-full border-8 ${status.border} ${status.bg} transition-all duration-700`}>
        <div className="flex flex-col items-center">
          <Icon size={48} className={status.color} />
          <span className={`text-2xl font-bold mt-2 ${status.color}`}>{status.label}</span>
          <span className="text-gray-500 text-sm font-medium">{score}점</span>
        </div>
      </div>
      <p className="mt-4 text-gray-500 text-sm font-semibold">위험도 분석 결과</p>
    </div>
  );
};

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('MAIN');
  const [inputValue, setInputValue] = useState('');
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [noUrlFound, setNoUrlFound] = useState(false);
  const [selectedTipId, setSelectedTipId] = useState<string | null>(null);
  const [scannerError, setScannerError] = useState<string | null>(null);
  
  const qrCodeScannerRef = useRef<Html5Qrcode | null>(null);
  const lastScannedResult = useRef<string | null>(null);
  const isTransitioning = useRef(false);

  const startScanner = async () => {
    if (isTransitioning.current) return;
    
    setNoUrlFound(false);
    setScannerError(null);
    lastScannedResult.current = null;
    
    isTransitioning.current = true;
    
    // Tiny delay to ensure DOM is ready
    await new Promise(resolve => setTimeout(resolve, 300));
    const element = document.getElementById("reader");
    if (!element) {
      console.warn("Reader element not found");
      isTransitioning.current = false;
      return;
    }

    // Clean up anything that might be left in the div
    element.innerHTML = "";

    try {
      if (qrCodeScannerRef.current) {
        try {
          await qrCodeScannerRef.current.stop();
        } catch (e) {
          // Ignore if it's already stopped
          console.debug("Ignored stop error:", e);
        }
        qrCodeScannerRef.current = null;
      }

      const h5qr = new Html5Qrcode("reader");
      qrCodeScannerRef.current = h5qr;
      
      const config = {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0,
      };

      // Try environment first
      try {
        await h5qr.start(
          { facingMode: "environment" },
          config,
          (decodedText) => {
            lastScannedResult.current = decodedText;
            // 즉시 분석 실행 (UX 개선)
            handleAnalyze(decodedText);
          },
          () => {} 
        );
      } catch (err) {
        console.warn("Environment camera failed, retrying with available cameras:", err);
        
        // Fallback: Get all cameras and try the first one
        const cameras = await Html5Qrcode.getCameras();
        if (cameras && cameras.length > 0) {
          // Find back camera if possible
          const backCamera = cameras.find(c => 
            c.label.toLowerCase().includes('back') || 
            c.label.toLowerCase().includes('rear') || 
            c.label.toLowerCase().includes('environment')
          );
          const cameraId = backCamera ? backCamera.id : cameras[0].id;
          
          await h5qr.start(
            cameraId,
            config,
            (decodedText) => {
              lastScannedResult.current = decodedText;
              // 즉시 분석 실행 (UX 개선)
              handleAnalyze(decodedText);
            },
            () => {}
          );
        } else {
          // Final fallback to any user camera
          await h5qr.start(
            { facingMode: "user" },
            config,
            (decodedText) => {
              lastScannedResult.current = decodedText;
              // 즉시 분석 실행 (UX 개선)
              handleAnalyze(decodedText);
            },
            () => {}
          );
        }
      }
      
      // Post-start fix for black screen on some mobile browsers
      const video = element.querySelector('video');
      if (video) {
        video.setAttribute('playsinline', 'true');
        video.setAttribute('muted', 'true');
        video.play().catch(e => console.warn("Video play failed:", e));
      }

    } catch (err) {
      console.error("Scanner failed:", err);
      setScannerError("카메라를 시작할 수 없습니다. 카메라 권한이 허용되어 있는지 확인하고 페이지를 새로고침해 주세요.");
    } finally {
      isTransitioning.current = false;
    }
  };

  const stopScanner = async () => {
    if (isTransitioning.current) {
      // If already transitioning, wait a bit and try once more or just return
      await new Promise(resolve => setTimeout(resolve, 100));
      if (isTransitioning.current) return;
    }

    if (qrCodeScannerRef.current) {
      isTransitioning.current = true;
      try {
        await qrCodeScannerRef.current.stop();
      } catch (e) {
        console.warn("Stop error during explicitly called stopScanner:", e);
      } finally {
        qrCodeScannerRef.current = null;
        isTransitioning.current = false;
      }
    }
  };

  const handleAnalyze = async (val: string) => {
    setCurrentScreen('RESULT'); // 결과 화면으로 먼저 전환 (만약 로딩이 필요하다면 여기서 로딩 상태를 보여줄 수 있음)
    setNoUrlFound(false);
    setAnalysisResult(null);

    const result = await performAnalysis(val);
    if (result) {
      setAnalysisResult(result);
    } else {
      setNoUrlFound(true);
    }
  };

  const handleCapture = async () => {
    const detected = lastScannedResult.current;
    await stopScanner();
    
    if (detected) {
      await handleAnalyze(detected);
    } else {
      setNoUrlFound(true);
      setAnalysisResult(null);
      setCurrentScreen('RESULT');
    }
  };

  useEffect(() => {
    if (currentScreen === 'QR_SCAN') {
      const timer = setTimeout(() => {
        startScanner();
      }, 300);
      return () => {
        clearTimeout(timer);
        stopScanner();
      };
    } else {
      stopScanner();
    }
  }, [currentScreen]);

  const selectedTip = useMemo(() => 
    TIP_CATEGORIES.find(t => t.id === selectedTipId), 
    [selectedTipId]
  );

  const transitionVariants = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
  };

  return (
    <div className="min-h-screen bg-gray-50 flex justify-center text-gray-900 font-sans">
      <div className="w-full max-w-[480px] min-h-screen flex flex-col bg-white overflow-hidden relative shadow-xl">
        <AnimatePresence mode="wait">
          {currentScreen === 'MAIN' && (
            <motion.div 
              key="main"
              variants={transitionVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="flex-1 flex flex-col p-6 space-y-8 mt-12"
            >
              <header className="text-center space-y-3">
                <div className="w-16 h-16 bg-indigo-600 rounded-3xl mx-auto flex items-center justify-center shadow-xl shadow-indigo-100">
                  <ShieldCheck className="text-white" size={32} />
                </div>
                <h1 className="text-3xl font-black tracking-tight">PhishingGuard</h1>
                <p className="text-gray-500 text-sm text-balance">
                  문자 피싱 및 QR 위협으로부터 당신의 정보를 안전하게 보호하세요.
                </p>
              </header>

              <div className="space-y-4">
                <textarea 
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="메시지 내용 혹은 URL을 입력하세요."
                  className="w-full h-40 p-5 bg-gray-50 border border-gray-200 rounded-3xl focus:border-indigo-500 outline-none transition-all resize-none text-gray-800 placeholder:text-gray-400 font-medium"
                />
                <button 
                  onClick={() => handleAnalyze(inputValue)}
                  className="w-full py-4 bg-indigo-600 text-white font-bold rounded-2xl shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                >
                  <Search size={20} />
                  분석하기
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <button 
                  onClick={() => setCurrentScreen('QR_SCAN')}
                  className="flex flex-col items-center justify-center p-6 bg-white border border-gray-100 rounded-3xl shadow-sm hover:border-indigo-500 transition-all group"
                >
                  <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mb-3 group-hover:bg-blue-100">
                    <Camera size={28} className="text-blue-600" />
                  </div>
                  <span className="font-bold text-gray-700">QR코드 탐지</span>
                </button>
                <button 
                  onClick={() => setCurrentScreen('TIPS')}
                  className="flex flex-col items-center justify-center p-6 bg-white border border-gray-100 rounded-3xl shadow-sm hover:border-indigo-500 transition-all group"
                >
                  <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center mb-3 group-hover:bg-emerald-100">
                    <BookOpen size={28} className="text-emerald-600" />
                  </div>
                  <span className="font-bold text-gray-700">보안 팁</span>
                </button>
              </div>
            </motion.div>
          )}

          {currentScreen === 'QR_SCAN' && (
            <motion.div 
              key="qr"
              variants={transitionVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="flex-1 flex flex-col bg-black h-full relative min-h-0"
            >
              <div className="absolute top-10 left-6 z-50">
                <button 
                  onClick={() => setCurrentScreen('MAIN')}
                  className="w-10 h-10 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center text-white"
                >
                  <ArrowLeft size={20} />
                </button>
              </div>

              <div className="flex-1 flex items-center justify-center relative bg-gray-900 overflow-hidden">
                <div id="reader" className="w-full h-full min-h-[400px]"></div>
                
                {scannerError && (
                  <div className="absolute inset-0 z-50 flex flex-col items-center justify-center p-10 text-center bg-gray-900/90 text-white">
                    <XCircle size={48} className="text-red-500 mb-4" />
                    <p className="font-bold text-lg mb-2">카메라 오류</p>
                    <p className="text-sm opacity-80 mb-6">{scannerError}</p>
                    <button 
                      onClick={startScanner}
                      className="px-6 py-2 bg-white text-black font-bold rounded-xl active:scale-95 transition-all"
                    >
                      다시 시도
                    </button>
                  </div>
                )}
                
                {!scannerError && (
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="w-64 h-64 relative border-2 border-white/20 rounded-3xl overflow-hidden">
                      <div className="absolute -top-1 -left-1 w-10 h-10 border-t-4 border-l-4 border-indigo-500 rounded-tl-2xl" />
                      <div className="absolute -top-1 -right-1 w-10 h-10 border-t-4 border-r-4 border-indigo-500 rounded-tr-2xl" />
                      <div className="absolute -bottom-1 -left-1 w-10 h-10 border-b-4 border-l-4 border-indigo-500 rounded-bl-2xl" />
                      <div className="absolute -bottom-1 -right-1 w-10 h-10 border-b-4 border-r-4 border-indigo-500 rounded-br-2xl" />
                      
                      <motion.div 
                        animate={{ top: ['0%', '100%', '0%'] }}
                        transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                        className="absolute left-0 right-0 h-0.5 bg-indigo-500 shadow-[0_0_15px_rgba(99,102,241,1)]"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="p-10 bg-black flex flex-col items-center">
                <button 
                  onClick={handleCapture}
                  className="w-20 h-20 bg-white rounded-full flex items-center justify-center p-1 active:scale-95 transition-all shadow-xl"
                >
                  <div className="w-full h-full border-2 border-black rounded-full" />
                </button>
                <p className="text-white/60 text-xs mt-6 font-medium tracking-wide text-center">촬영 버튼을 눌러 스캔 결과를 확인하세요</p>
              </div>
            </motion.div>
          )}

          {currentScreen === 'RESULT' && (
            <motion.div 
              key="result"
              variants={transitionVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="flex-1 flex flex-col bg-gray-50 h-full"
            >
              <nav className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-white">
                <button 
                  onClick={() => setCurrentScreen('MAIN')}
                  className="w-10 h-10 bg-gray-50 rounded-full flex items-center justify-center"
                >
                  <ArrowLeft size={18} />
                </button>
                <h2 className="font-bold text-lg">상세 분석 보고서</h2>
                <div className="w-10" />
              </nav>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {noUrlFound ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-20 text-center">
                    <div className="w-20 h-20 bg-red-50 text-red-500 font-bold rounded-full flex items-center justify-center mb-6">
                      <AlertTriangle size={40} />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900">감지된 URL 링크가 없습니다.</h3>
                    <p className="text-gray-500 mt-2 text-sm leading-relaxed px-10">
                      내용에서 분석 가능한 URL 주소를 찾을 수 없습니다. 다시 시도해 주세요.
                    </p>
                  </div>
                ) : analysisResult && (
                  <>
                    <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100">
                      <RiskGauge score={analysisResult.score} />
                    </div>

                    <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                          {analysisResult.type === 'URL' ? '분석 URL' : '분석 전화번호'}
                        </span>
                        <ExternalLink size={14} className="text-gray-300" />
                      </div>
                      <p className="text-xs font-mono break-all text-gray-800 bg-gray-50 p-3 rounded-xl">
                        {analysisResult.input}
                      </p>
                    </div>

                    {analysisResult.messageThreats && analysisResult.messageThreats.length > 0 && (
                      <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm space-y-3">
                        <div className="flex items-center gap-2">
                          <MessageSquare size={16} className="text-indigo-500" />
                          <span className="text-[11px] font-bold text-gray-500 uppercase tracking-tight">메시지 내용 분석</span>
                        </div>
                        <div className="space-y-2">
                          {analysisResult.messageThreats.map((threat, idx) => (
                            <div key={idx} className="flex gap-2 items-start bg-indigo-50/50 p-3 rounded-2xl border border-indigo-100">
                              <AlertTriangle size={14} className="text-indigo-500 shrink-0 mt-0.5" />
                              <p className="text-[11px] font-bold text-indigo-900 leading-tight">
                                {threat}
                              </p>
                            </div>
                          ))}
                        </div>
                        {analysisResult.detectedKeywords && analysisResult.detectedKeywords.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {analysisResult.detectedKeywords.map((kw, i) => (
                              <span key={i} className="text-[9px] bg-indigo-100 text-indigo-600 px-2.5 py-1 rounded-full font-bold">
                                #{kw}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <img src="https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_92x30dp.png" alt="Google" className="h-3 overflow-visible" referrerPolicy="no-referrer" />
                          <span className="text-[11px] font-bold text-gray-500">Safe Browsing</span>
                        </div>
                        {analysisResult.safeBrowsingError ? (
                          <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-bold">확인 불가</span>
                        ) : analysisResult.safeBrowsingMatches && analysisResult.safeBrowsingMatches.length > 0 ? (
                          <span className="text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-bold">위험 탐지</span>
                        ) : (
                          <span className="text-[10px] bg-green-100 text-green-600 px-2 py-0.5 rounded-full font-bold">안전함</span>
                        )}
                      </div>
                      
                      {analysisResult.safeBrowsingError ? (
                        <p className="text-[11px] text-gray-500 leading-relaxed font-medium bg-gray-50 p-3 rounded-xl">
                          서버 연결 문제로 실시간 보안 DB 조회를 수행하지 못했습니다.
                        </p>
                      ) : (analysisResult.safeBrowsingMatches && analysisResult.safeBrowsingMatches.length > 0) ? (
                        <div className="space-y-2">
                          {analysisResult.safeBrowsingMatches.map((match, idx) => (
                            <div key={idx} className="flex gap-2 items-start bg-red-50 p-2.5 rounded-xl border border-red-100">
                              <ShieldAlert size={14} className="text-red-500 shrink-0 mt-0.5" />
                              <div className="space-y-1">
                                <p className="text-[11px] font-bold text-red-900 leading-tight">
                                  {match.threatType === 'MALWARE' ? '악성 코드 탐지' : 
                                   match.threatType === 'SOCIAL_ENGINEERING' ? '피싱/사기 사이트' : 
                                   match.threatType === 'UNWANTED_SOFTWARE' ? '유해 소프트웨어' : '보안 위협'}
                                </p>
                                <p className="text-[10px] text-red-700/70 leading-tight">
                                  Google의 대규모 보안 데이터베이스에 등록된 유해한 사이트입니다.
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[11px] text-gray-600 leading-relaxed font-medium bg-green-50 p-3 rounded-xl flex items-center gap-2">
                          <CheckCircle2 size={14} className="text-green-500" />
                          Google 데이터베이스에 보고된 위협 정보가 없습니다.
                        </p>
                      )}
                    </div>

                    {analysisResult.safeBrowsingError && (
                      <div className="p-4 bg-gray-100 border border-gray-200 rounded-3xl flex gap-3 items-center mx-1">
                        <Info size={18} className="text-gray-500 shrink-0" />
                        <p className="text-[11px] text-gray-600 leading-relaxed font-medium">
                          Google Safe Browsing 연결 실패로 일부 분석이 제한될 수 있습니다.
                        </p>
                      </div>
                    )}

                    <div className="space-y-4">
                      <h3 className="font-bold text-gray-900 px-1">탐지 결과</h3>
                      <div className="space-y-3">
                        {analysisResult.reasons.length > 0 ? (
                          analysisResult.reasons.map((reason, idx) => (
                            <div 
                              key={idx} 
                              className="p-5 rounded-3xl border bg-red-50 border-red-100 flex gap-4"
                            >
                              <div className="mt-0.5 text-red-500">
                                <AlertTriangle size={22} />
                              </div>
                              <div>
                                <p className="text-sm font-bold text-red-900">{reason}</p>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="p-5 rounded-3xl border bg-green-50 border-green-100 flex gap-4">
                            <div className="mt-0.5 text-green-500">
                              <CheckCircle2 size={22} />
                            </div>
                            <div>
                              <p className="text-sm font-bold text-green-900">의심스러운 징후가 발견되지 않았습니다.</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h3 className="font-bold text-gray-900 px-1">권장 사항</h3>
                      <div className="bg-blue-50 border border-blue-100 p-6 rounded-3xl space-y-3">
                        {analysisResult.recommendations.map((rec, idx) => (
                          <div key={idx} className="flex gap-3 items-start">
                            <div className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                              <CheckCircle2 size={12} className="text-white" />
                            </div>
                            <p className="text-sm text-blue-900 leading-relaxed">{rec}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>

              <footer className="p-6 bg-white border-t border-gray-50 space-y-3">
                {!noUrlFound && (
                  <button 
                    onClick={() => setCurrentScreen('TIPS')}
                    className="w-full py-4 text-gray-700 font-bold bg-gray-50 rounded-2xl flex items-center justify-between px-6 active:bg-gray-100 transition-colors"
                  >
                    보안 팁 보러가기
                    <ChevronRight size={18} className="text-gray-400" />
                  </button>
                )}
                <button 
                  onClick={() => {
                    setInputValue('');
                    setNoUrlFound(false);
                    setAnalysisResult(null);
                    setCurrentScreen('MAIN');
                  }}
                  className="w-full py-4 bg-gray-900 text-white font-bold rounded-2xl shadow-lg active:scale-[0.98] transition-all"
                >
                  메인으로 이동
                </button>
              </footer>
            </motion.div>
          )}

          {currentScreen === 'TIPS' && (
            <motion.div 
              key="tips"
              variants={transitionVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="flex-1 flex flex-col bg-white h-full"
            >
              <nav className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <button onClick={() => setCurrentScreen('MAIN')} className="w-10 h-10 bg-gray-50 rounded-full flex items-center justify-center">
                  <ArrowLeft size={18} />
                </button>
                <h2 className="font-bold text-lg text-center">보안 팁 리스트</h2>
                <div className="w-10" />
              </nav>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {TIP_CATEGORIES.map((tip) => (
                  <button 
                    key={tip.id}
                    onClick={() => {
                      setSelectedTipId(tip.id);
                      setCurrentScreen('TIP_DETAIL');
                    }}
                    className="w-full p-6 text-left bg-white border border-gray-100 rounded-3xl hover:border-indigo-400 transition-all flex items-center gap-5 shadow-sm"
                  >
                    <div className="w-14 h-14 bg-gray-50 rounded-2xl flex items-center justify-center text-3xl">
                      {tip.icon}
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold text-gray-900">{tip.title}</h3>
                      <p className="text-xs text-gray-500 mt-1">{tip.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {currentScreen === 'TIP_DETAIL' && selectedTip && (
            <motion.div 
              key="tip_detail"
              variants={transitionVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="flex-1 flex flex-col bg-white h-full"
            >
              <nav className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <button onClick={() => setCurrentScreen('TIPS')} className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-700">
                  <ArrowLeft size={18} />
                </button>
                <h2 className="font-bold text-lg uppercase tracking-tight">{selectedTip.title}</h2>
                <div className="w-10" />
              </nav>

              <div className="flex-1 overflow-y-auto p-10 space-y-12">
                <div className="flex flex-col items-center text-center space-y-6">
                  <div className="w-24 h-24 bg-gray-50 rounded-[2.5rem] flex items-center justify-center text-5xl">
                    {selectedTip.icon}
                  </div>
                  <p className="text-lg font-bold text-indigo-600 leading-relaxed px-2">
                    {selectedTip.description}
                  </p>
                </div>

                <div className="space-y-8">
                  <h4 className="font-black text-gray-900 flex items-center gap-3 border-b border-gray-100 pb-4">
                    <Info className="text-indigo-500" size={20} />
                    핵심 수칙
                  </h4>
                  <div className="space-y-6">
                    {selectedTip.details.map((detail, idx) => (
                      <div key={idx} className="flex gap-5 items-start">
                        <span className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-1">{idx + 1}</span>
                        <p className="text-gray-600 leading-relaxed text-[15px]">
                          {detail}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-6 shrink-0">
                <button 
                  onClick={() => setCurrentScreen('TIPS')}
                  className="w-full py-4 bg-gray-900 text-white font-bold rounded-2xl"
                >
                  목록으로 돌아가기
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        #reader video { 
          object-fit: cover !important; 
          width: 100% !important; 
          height: 100% !important; 
        }
        #reader { border: none !important; }
        #reader__dashboard { display: none !important; }
        #reader__status_span { display: none !important; }
        @keyframes pulse-soft {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.8; }
        }
        .animate-pulse-soft { animation: pulse-soft 2s infinite ease-in-out; }
      `}} />
    </div>
  );
}

