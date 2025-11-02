// 타이머 설명 생성 테스트 스크립트
import 'dotenv/config';
import fetch from 'node-fetch';

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

async function callGroqChat(messages, { max_tokens = 256, temperature = 0.6 } = {}) {
  if (!GROQ_API_KEY) throw new Error('Missing GROQ_API_KEY');
  const res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      max_tokens,
      temperature,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq API error: ${res.status} ${err}`);
  }
  const json = await res.json();
  return json.choices[0]?.message?.content || '';
}

function clampText(s = '', min = 1, max = 50) {
  let t = (s || '').trim();
  if (!t) return '';
  
  const emojiRegex = /\p{Emoji}/u;
  const emojiAllRegex = /\p{Emoji}/gu;
  
  // 여러 문장 체크 (마침표가 2개 이상이면 첫 문장만)
  const periodCount = (t.match(/\./g) || []).length;
  if (periodCount > 1) {
    const firstPeriod = t.indexOf('.');
    if (firstPeriod > 0) {
      t = t.slice(0, firstPeriod + 1);
    }
  }
  
  // 이모지 추가 전 길이 확인
  const hasEmoji = emojiAllRegex.test(t);
  let needsEmoji = max > 15 && !hasEmoji;
  
  // 이모지를 추가할 경우를 고려한 길이 계산
  let targetLength = max;
  if (needsEmoji) {
    targetLength = max - 2; // ' ☕' 공간 확보
  }
  
  // 최대 길이 초과 시 자르기
  if (t.length > targetLength) {
    // 문장 부호로 끝나는 위치 찾기
    const sentenceEndPattern = /[.!?]/g;
    const endMatches = [...t.matchAll(sentenceEndPattern)];
    
    let bestEnd = -1;
    if (endMatches.length > 0) {
      const firstEnd = endMatches[0].index + 1;
      if (firstEnd <= targetLength) {
        bestEnd = firstEnd;
      }
    }
    
    // 공백으로 자르기
    if (bestEnd === -1) {
      const lastSpace = t.lastIndexOf(' ', targetLength);
      if (lastSpace > targetLength * 0.6) {
        bestEnd = lastSpace;
      } else {
        bestEnd = targetLength;
      }
    }
    
    t = t.slice(0, bestEnd).trim();
  }
  
  // 최소 길이 미달 시 fallback
  if (t.length < min) {
    return null; // fallback 필요
  }
  
  // 이모지 추가
  if (needsEmoji) {
    t = t.trim() + ' ☕';
  }
  
  // 최종 길이 확인 (이모지 포함)
  if (t.length > max) {
    // 이모지 포함 길이 조정
    const emojiLength = (t.match(emojiAllRegex) || []).reduce((acc, emoji) => acc + emoji.length, 0);
    const textLength = t.length - emojiLength;
    const allowedTextLength = max - emojiLength - 1; // 공백 포함
    
    if (textLength > allowedTextLength) {
      t = t.slice(0, allowedTextLength).trim() + (hasEmoji ? '' : ' ☕');
    }
  }
  
  return t.trim();
}
  

function validateKoreanSpelling(s = '') {
  if (!s || typeof s !== 'string') return '';
  let text = s.trim();
  if (!text) return '';
  
  // 1. 한글, 공백, 중점, 이모지만 허용
  const validCharsRegex = /^[가-힣\s·\p{Emoji}]+$/u;
  if (!validCharsRegex.test(text)) {
    text = text.replace(/[^가-힣\s·\p{Emoji}]/gu, '');
  }
  
  // 2. 이상한 문자 조합 차단
  const suspiciousPatterns = [
    /[ㄱ-ㅎ]{3,}/, // 자음 3개 이상 연속
    /[ㅏ-ㅣ]{3,}/, // 모음 3개 이상 연속
    /[가-힣]{1}[ㄱ-ㅎ]{2,}/, // 한글 + 자음 연속
    /[가-힣]{1}[ㅏ-ㅣ]{2,}/, // 한글 + 모음 연속
    /([가-힣])\1{3,}/, // 같은 글자 4개 이상 반복
  ];
  
  if (suspiciousPatterns.some(p => p.test(text))) {
    return '';
  }
  
  // 3. 띄어쓰기 오류 검사 (기본 패턴)
  text = text.replace(/\s{2,}/g, ' ');
  
  // 4. 여러 문장 체크 (마침표가 중간에 있으면 두 문장 이상)
  const periodCount = (text.match(/\./g) || []).length;
  if (periodCount > 1) {
    const firstPeriod = text.indexOf('.');
    if (firstPeriod > 0) {
      text = text.slice(0, firstPeriod + 1);
    } else {
      return '';
    }
  }
  
  // 5. 이모지 확인 및 추가 (맨 마지막에 이모지가 있어야 함)
  const emojiRegex = /\p{Emoji}/u;
  if (!emojiRegex.test(text)) {
    text = text.trim() + ' ☕';
  }
  
  return text.trim();
}

async function generateTimerDescription(context = {}) {
  const minChars = 10;
  const maxChars = 28;
  const seed = '쉬면서 일해야 건강하고 행복해요!';
  
  const sys = `${minChars}~${maxChars}자 한국어 완전한 문장 하나만 출력. 여러 문장 절대 금지. 한 문장만. 존대어 사용(반말 금지). 활기 넘치고 응원하는 경향으로 작성. 쉬면서 일하는 것의 효과를 강조: "쉬면서 일하면 효율이 오릅니다.", "오늘도 쉬엄쉬엄 일하세요.", "적절한 휴식이 생산성을 높입니다." 등의 메시지를 포함. 휴식이 건강과 생산성에 도움이 된다는 것을 명확히 전달. 맨 마지막에 문장 내용에 맞는 이모지를 반드시 포함하되, 사람이 등장하는 이모지(💆, 💪 등)는 사용하지 말고 표정 이모지(😊, 😌 등), 하트(❤️, 💚, 💙 등), 🌿, ☕, 🍵 중점적으로 사용해야 함. 한국어 맞춤법이 완벽해야 함.`;
  
  const optimizedContext = {
    wp: context?.workPatterns?.slice(0, 2) || [],
    hc: context?.healthConcerns?.slice(0, 2) || [],
  };
  const user = JSON.stringify(optimizedContext);
  
  try {
    const text = await callGroqChat(
      [{ role: 'system', content: sys }, { role: 'user', content: user }],
      { max_tokens: 60, temperature: 0.8 }
    );
    
    // 프롬프트가 그대로 반환되는 경우 체크
    let cleanedText = String(text || '').trim();
    if (cleanedText.includes('한국어 완전한 문장') || cleanedText.includes('웰니스 코치') || cleanedText.includes('존대어 사용')) {
      cleanedText = '';
    }
    
    if (!cleanedText) {
      return null;
    }
    
    let clamped = clampText(cleanedText, minChars, maxChars);
    
    // clampText가 null을 반환하면 (최소 길이 미달) 실패
    if (!clamped) {
      return null;
    }
    
    const validated = validateKoreanSpelling(clamped);
    clamped = validated || clamped;
    
    // 최종 길이 재확인 (이모지 포함 28자 이하)
    if (clamped && clamped.length > maxChars) {
      // 강제로 잘라내기 (이모지 보존)
      const emojiMatch = clamped.match(/\p{Emoji}/u);
      const emoji = emojiMatch ? emojiMatch[0] : '';
      const textPart = clamped.replace(/\p{Emoji}/gu, '').trim();
      const allowedTextLength = maxChars - (emoji ? emoji.length + 1 : 0); // 공백 포함
      clamped = textPart.slice(0, allowedTextLength).trim() + (emoji ? ' ' + emoji : ' ☕');
    }
    
    return clamped;
  } catch (e) {
    console.error('Error:', e.message);
    return null;
  }
}

async function main() {
  console.log('타이머 설명 생성 테스트 시작...\n');
  console.log('='.repeat(60));
  
  const context = {
    workPatterns: ['coding', 'writing'],
    healthConcerns: ['eyeStrain', 'neckPain'],
  };
  
  const results = [];
  for (let i = 1; i <= 10; i++) {
    process.stdout.write(`[${i}/10] 생성 중... `);
    const text = await generateTimerDescription(context);
    if (text) {
      console.log(`✓ ${text.length}자: ${text}`);
      results.push({ index: i, text, length: text.length });
    } else {
      console.log('✗ 생성 실패');
      results.push({ index: i, text: null, length: 0 });
    }
    
    // API 레이트 리미트 방지
    if (i < 10) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('\n결과 요약:');
  console.log(`성공: ${results.filter(r => r.text).length}/10`);
  console.log(`실패: ${results.filter(r => !r.text).length}/10`);
  console.log('\n생성된 텍스트:');
  results.forEach(r => {
    if (r.text) {
      console.log(`  ${r.index}. [${r.length}자] ${r.text}`);
    }
  });
}

main().catch(console.error);

