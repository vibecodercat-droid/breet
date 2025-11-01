# Breet 로그인 및 동기화 기능 기획서 (PRD 확장)

## 1. 제품 개요 (Overview)

- **기능명**: Breet 클라우드 동기화 및 멀티디바이스 지원
- **비전**: 사용자 인증과 클라우드 저장소를 통해 여러 기기에서 브레이크 기록을 안전하게 동기화하고, 데이터 손실 없이 사용자의 건강한 습관을 지원
- **기술 스택**: 
  - 프론트: Chrome Extension (MV3) + `chrome.identity.launchWebAuthFlow`
  - 백엔드: Spring Boot + Spring Security + OAuth2 Client + JWT
  - 데이터베이스: PostgreSQL (또는 Firestore)
  - 동기화: 실시간 API 호출 + 오프라인 큐

---

## 2. 목표 및 성공 지표 (Goals & KPIs)

- **비즈니스 목표**
  - 로그인 사용자 비율 ≥ 80% (온보딩 후 7일 내)
  - 멀티디바이스 사용자 비율 ≥ 30% (2주 MVP 테스트 후)
  - 데이터 동기화 성공률 ≥ 95% (API 응답 기준)

- **사용자 목표**
  - 로그인 없이도 로컬 사용 가능 (오프라인 우선)
  - 로그인 시 모든 기기에서 기록 동기화
  - 데이터 백업 및 복구 기능

---

## 3. 타깃 사용자 (User Persona)

- **김지원 (29세, 개발자)** - 기존 PRD 동일
  - 로그인 필요성: 여러 컴퓨터에서 사용 (회사/집), 데이터 손실 우려
  - 기대: 간편한 Google 로그인, 자동 동기화

---

## 4. 기능 요구사항 (Feature Requirements)

### 4.1 로그인/로그아웃

- **목적**: 사용자 인증 및 클라우드 동기화 활성화

- **기능**:
  1. **로그인**: Google OAuth2 로그인 (필수), 추후 Kakao/Naver 추가 가능
  2. **로그아웃**: 로컬 데이터 유지(옵션), 클라우드 데이터 삭제(선택)
  3. **상태 표시**: 팝업 헤더에 로그인 상태 표시 (아이콘 + 이메일)

- **플로우**:
  1. 사용자가 팝업/설정에서 "로그인" 버튼 클릭
  2. `chrome.identity.launchWebAuthFlow`로 백엔드 OAuth2 엔드포인트 호출
  3. 백엔드가 Google 로그인 페이지로 리다이렉트
  4. 사용자가 Google 계정 로그인 완료
  5. 백엔드가 인가 코드 → Access 토큰 → 사용자 정보 조회
  6. 백엔드가 JWT(Access + Refresh) 발급 후 익스텐션 리다이렉트 URI로 전달
  7. 익스텐션이 토큰을 `chrome.storage.local`에 저장 (`accessToken`, `refreshToken`)
  8. 로컬 데이터가 있으면 서버에 업로드 (초기 동기화)
  9. 팝업 UI에 로그인 상태 반영

- **데이터 저장 구조** (`authState`):
```jsx
const authState = {
  isLoggedIn: true,
  userId: 'uuid-from-server',
  email: 'user@example.com',
  accessToken: 'jwt-access-token',
  refreshToken: 'jwt-refresh-token',
  tokenExpiresAt: Date.now() + 3600000, // 1시간
  lastSyncedAt: Date.now(),
};
```

### 4.2 데이터 동기화

- **목적**: 로컬 ↔ 클라우드 양방향 동기화

- **동기화 대상 데이터**:
  - `userProfile`: 온보딩 정보, 루틴 설정, 스케줄
  - `breakHistory`: 브레이크 실행 기록 (시간, 완료 여부, 타입)
  - `todos`: 할 일 목록
  - `dailyStats`: 일별 통계 (선택적, 서버에서 집계)

- **동기화 전략**:
  1. **초기 로그인 시**: 로컬 데이터 → 서버 업로드 (서버에 데이터 없을 때만)
  2. **평시 동기화**: 쓰기 시 로컬 저장 + 즉시 서버 업데이트 (비동기)
  3. **읽기 시**: 로컬 우선, 백그라운드에서 서버 pull 후 로컬 갱신
  4. **충돌 해결**: `updatedAt` 최신 기준 덮어쓰기 (간단 규칙)
  5. **오프라인**: 로컬 저장 후 큐에 추가, 온라인 복귀 시 배치 업로드

- **API 엔드포인트**:
  - `GET /api/users/me` - 현재 사용자 정보
  - `GET /api/profiles` - 사용자 프로필 조회
  - `PUT /api/profiles` - 프로필 업데이트
  - `GET /api/break-history?from=DATE&to=DATE` - 브레이크 기록 조회
  - `POST /api/break-history` - 브레이크 기록 추가 (배치 가능)
  - `GET /api/todos` - 할 일 조회
  - `PUT /api/todos` - 할 일 업데이트 (배치 가능)
  - `GET /api/stats/daily?date=DATE` - 일별 통계
  - `GET /api/stats/weekly?from=DATE&to=DATE` - 주간 통계

### 4.3 오프라인 지원

- **목적**: 로그인 없이도 로컬에서 모든 기능 사용 가능

- **기능**:
  1. 로그인 전: 모든 데이터는 `chrome.storage.local`에만 저장
  2. 로그인 후: 로컬 저장 + 서버 동기화 (옵션으로 끄기 가능)
  3. 오프라인 큐: 네트워크 실패 시 로컬 큐에 저장, 재시도 로직
  4. 오프라인 표시: UI에 동기화 상태 배지 표시 (연결됨/동기화 중/오프라인)

### 4.4 데이터 백업 및 복구

- **목적**: 사용자 데이터 보호 및 복구 기능

- **기능**:
  1. **자동 백업**: 클라우드에 자동 저장 (로그인 시)
  2. **수동 내보내기**: 설정 페이지에서 CSV/JSON 다운로드 (기존 기능 유지)
  3. **복구**: 새 기기에서 로그인 시 자동 복구 (서버 → 로컬)
  4. **데이터 초기화**: 설정에서 "모든 데이터 삭제" 옵션 (로컬/클라우드 선택 가능)

---

## 5. 데이터베이스 스키마

### 5.1 PostgreSQL 스키마 (권장)

```sql
-- 사용자 테이블
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(50) NOT NULL, -- 'google', 'kakao', 'naver'
    provider_user_id VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    image_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(provider, provider_user_id)
);

-- 사용자 프로필 (온보딩 정보)
CREATE TABLE profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    onboarding_completed BOOLEAN DEFAULT false,
    onboarding_date TIMESTAMPTZ,
    work_patterns TEXT[], -- ['coding', 'writing', ...]
    health_concerns TEXT[], -- ['eyeStrain', 'neckPain', ...]
    preferred_break_types TEXT[], -- ['eyeExercise', 'stretching', ...]
    routine JSONB, -- {type: 'pomodoro', workDuration: 25, breakDuration: 5}
    schedule JSONB, -- {startTime: '09:00', endTime: '18:00', includeWeekends: false}
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 브레이크 기록
CREATE TABLE break_history (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    break_id VARCHAR(100) NOT NULL, -- 'eye_20_20_20', ...
    break_type VARCHAR(50) NOT NULL, -- 'eyeExercise', 'stretching', ...
    duration INTEGER NOT NULL, -- 분 단위
    completed BOOLEAN NOT NULL DEFAULT true,
    timestamp TIMESTAMPTZ NOT NULL,
    source VARCHAR(50) DEFAULT 'extension', -- 'extension', 'web', ...
    created_at TIMESTAMPTZ DEFAULT NOW(),
    INDEX idx_user_timestamp (user_id, timestamp),
    INDEX idx_user_completed_timestamp (user_id, completed, timestamp)
);

-- 할 일 목록
CREATE TABLE todos (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    completed BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    INDEX idx_user_updated (user_id, updated_at)
);

-- 일별 통계 (선택적, 성능 최적화용)
CREATE TABLE stats_daily (
    date DATE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total INTEGER DEFAULT 0,
    completed INTEGER DEFAULT 0,
    rate NUMERIC(5,2) DEFAULT 0.00, -- 완료율
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (date, user_id),
    INDEX idx_user_date (user_id, date)
);

-- 세션 기록 (선택적, 이벤트 추적용)
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode VARCHAR(50) NOT NULL, -- 'pomodoro', 'long', 'short'
    start_ts BIGINT NOT NULL,
    work_duration INTEGER NOT NULL,
    break_duration INTEGER NOT NULL,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 리프레시 토큰 관리 (보안)
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    INDEX idx_user_expires (user_id, expires_at)
);
```

### 5.2 Firestore 대안 (간단한 케이스)

```javascript
// 컬렉션 구조
users/{userId}
  - profile: { onboardingCompleted, workPatterns[], ... }
  - breakHistory/{breakId}: { breakId, breakType, duration, completed, timestamp }
  - todos/{todoId}: { text, completed, updatedAt }
  - stats_daily/{dateKey}: { total, completed, rate }
```

---

## 6. 백엔드 API 명세 (Spring Boot)

### 6.1 인증 API

- `GET /oauth2/authorization/google` - OAuth2 로그인 시작 (Spring Security 기본)
- `GET /login/oauth2/code/google` - OAuth2 콜백 (익스텐션 리다이렉트 URI)
- `POST /api/auth/refresh` - Access 토큰 갱신 (Refresh 토큰 사용)
- `POST /api/auth/logout` - 로그아웃 (Refresh 토큰 무효화)
- `GET /api/users/me` - 현재 사용자 정보

### 6.2 데이터 API

- `GET /api/profiles` - 프로필 조회
- `PUT /api/profiles` - 프로필 업데이트
- `GET /api/break-history?from=DATE&to=DATE&limit=100` - 브레이크 기록 조회
- `POST /api/break-history` - 브레이크 기록 추가 (단일 또는 배열)
- `GET /api/todos` - 할 일 조회
- `PUT /api/todos` - 할 일 업데이트 (배열로 받아서 전체 교체)
- `GET /api/stats/daily?date=YYYY-MM-DD` - 일별 통계
- `GET /api/stats/weekly?from=DATE&to=DATE` - 주간 통계

### 6.3 보안 설정

- JWT 토큰 만료: Access 1시간, Refresh 7일
- CORS: `chrome-extension://<EXT_ID>` 및 웹앱 도메인만 허용
- 인증 필터: `Authorization: Bearer <access_token>` 헤더 검증
- 리프레시 토큰: DB에 해시 저장, 무효화 가능

---

## 7. 익스텐션 코드 구조 확장

### 7.1 새로운 파일 구조

```
breet/
├── manifest.json (identity 권한 추가)
├── lib/
│   ├── auth.js          # 로그인/로그아웃/토큰 관리
│   ├── sync.js           # 동기화 로직 (업로드/다운로드)
│   └── api.js            # API 호출 유틸 (JWT 헤더 자동 추가)
├── popup/
│   ├── popup.html        # 로그인 버튼 추가
│   └── popup.js          # 로그인 상태 체크
└── pages/
    └── settings.html     # 동기화 설정 추가
```

### 7.2 주요 모듈

- **lib/auth.js**:
  - `loginWithGoogle()` - launchWebAuthFlow 실행
  - `logout()` - 로그아웃 + 로컬 데이터 삭제 옵션
  - `refreshAccessToken()` - Refresh 토큰으로 Access 갱신
  - `isAuthenticated()` - 로그인 상태 확인
  - `getAccessToken()` - 현재 Access 토큰 반환 (자동 갱신)

- **lib/api.js**:
  - `apiCall(url, method, body)` - JWT 자동 추가, 401 시 자동 리프레시
  - `uploadProfile(profile)` - 프로필 업로드
  - `uploadBreakHistory(history)` - 브레이크 기록 배치 업로드
  - `downloadProfile()` - 프로필 다운로드
  - `downloadBreakHistory(from, to)` - 브레이크 기록 다운로드

- **lib/sync.js**:
  - `syncProfile()` - 프로필 동기화 (양방향 merge)
  - `syncBreakHistory()` - 브레이크 기록 동기화 (중복 제거)
  - `syncTodos()` - 할 일 동기화
  - `queueSync(action, data)` - 오프라인 큐에 추가
  - `processQueue()` - 큐 처리 (온라인 복귀 시)

---

## 8. UI/UX 변경사항

### 8.1 팝업 헤더

- 로그인 상태 표시:
  - 로그인 안 함: "로그인" 버튼 (Google 아이콘)
  - 로그인 함: 사용자 이메일 + "로그아웃" 버튼
  - 동기화 상태: 작은 배지 (🟢 동기화됨 / 🟡 동기화 중 / ⚪ 오프라인)

### 8.2 설정 페이지

- 새 섹션: "클라우드 동기화"
  - 로그인/로그아웃 버튼
  - 자동 동기화 토글 (ON/OFF)
  - "동기화 지금 하기" 버튼
  - "서버 데이터 삭제" 버튼 (주의)

### 8.3 온보딩 완료 후

- 옵션 1: 온보딩 완료 시 "클라우드에 저장하시겠습니까?" 팝업
- 옵션 2: 온보딩 완료 후 설정에서 로그인 유도 (권장, 덜 방해)

---

## 9. 구현 단계 (2주 MVP 확장)

### 주 1: 인증 기본 구현

- **Day 1-2**: 백엔드 OAuth2 + JWT 설정
  - Spring Security OAuth2 Client 설정
  - Google OAuth2 클라이언트 등록
  - JWT 발급 로직 (Access + Refresh)
  - 익스텐션 리다이렉트 URI 처리

- **Day 3-4**: 익스텐션 로그인 플로우
  - `manifest.json`에 `identity` 권한 추가
  - `lib/auth.js` 구현 (loginWithGoogle, logout)
  - 팝업에 로그인 버튼 추가
  - 토큰 저장/로드 로직

- **Day 5**: API 인증 및 사용자 정보
  - `/api/users/me` 엔드포인트
  - 익스텐션에서 `/api/users/me` 호출 테스트
  - JWT 검증 필터 적용

### 주 2: 동기화 구현

- **Day 6-7**: 프로필 동기화
  - `/api/profiles` GET/PUT 엔드포인트
  - `lib/sync.js` 프로필 동기화 로직
  - 온보딩 완료 시 자동 업로드
  - 설정 변경 시 자동 업로드

- **Day 8-9**: 브레이크 기록 동기화
  - `/api/break-history` GET/POST 엔드포인트
  - `lib/sync.js` 브레이크 기록 동기화 (중복 제거)
  - 브레이크 완료 시 자동 업로드
  - 통계 페이지에서 서버 데이터 조회

- **Day 10**: 할 일 동기화
  - `/api/todos` GET/PUT 엔드포인트
  - 할 일 추가/수정 시 자동 동기화

- **Day 11-12**: 오프라인 큐 및 UI 개선
  - 오프라인 큐 구현
  - 동기화 상태 표시 (팝업 헤더)
  - 오류 처리 및 재시도 로직

- **Day 13-14**: 테스트 및 버그 수정
  - 멀티디바이스 테스트
  - 충돌 해결 로직 검증
  - 성능 최적화

---

## 10. 보안 고려사항

- **토큰 관리**:
  - Access 토큰: 로컬 스토리지에 평문 저장 (MVP), 향후 암호화
  - Refresh 토큰: DB에 해시 저장, 무효화 가능
  - 토큰 자동 갱신: 만료 전 5분 전 자동 리프레시

- **데이터 보호**:
  - 모든 API 요청에 JWT 검증
  - 사용자별 데이터 격리 (DB RLS 또는 애플리케이션 레벨)
  - HTTPS 필수 (프로덕션)

- **개인정보**:
  - 이메일/이름만 수집 (Google OAuth2 기본 제공)
  - 브라우징 기록/URL 수집 금지
  - 사용자 동의 없이 데이터 공유 금지

---

## 11. 성공 지표 측정

- **로그인 전환율**: 온보딩 완료 사용자 중 로그인 비율
- **동기화 성공률**: 브레이크 기록 업로드 성공률 (API 응답 기준)
- **멀티디바이스 사용률**: 2개 이상 기기에서 로그인한 사용자 비율
- **오프라인 큐 처리율**: 오프라인 중 저장된 데이터의 온라인 복귀 시 업로드 성공률

---

## 12. 향후 확장 가능성

- **추가 소셜 로그인**: Kakao, Naver (백엔드 OAuth2 Client 추가만)
- **데이터 분석**: 서버에서 집계 통계 제공 (전체 사용자 대비 개인 순위 등)
- **푸시 알림**: 서버에서 브레이크 알림 스케줄링 (웹훅)
- **팀 기능**: 여러 사용자 간 브레이크 챌린지 (후속 버전)

---

## 13. Cursor 개발용 프롬프트 예시

### 1. 백엔드 OAuth2 설정

```
Spring Boot에 OAuth2 로그인을 구현해주세요.

- Spring Security OAuth2 Client 설정
- Google OAuth2 클라이언트 등록 (application.yml)
- JWT 토큰 발급 (Access 1시간, Refresh 7일)
- 익스텐션 리다이렉트 URI 처리 (chrome-extension://<EXT_ID>/auth_callback.html)
- /api/users/me 엔드포인트 (현재 사용자 정보 반환)
```

### 2. 익스텐션 로그인 플로우

```
lib/auth.js에 Google 로그인을 구현해주세요.

- chrome.identity.launchWebAuthFlow 사용
- 백엔드 OAuth2 엔드포인트 호출
- 리다이렉트 URL에서 access_token, refresh_token 추출
- chrome.storage.local에 토큰 저장
- 로그아웃 기능 (토큰 삭제 + 백엔드 호출)
```

### 3. 동기화 모듈

```
lib/sync.js에 데이터 동기화 로직을 구현해주세요.

- 프로필 동기화 (uploadProfile, downloadProfile, mergeProfile)
- 브레이크 기록 동기화 (배치 업로드, 중복 제거, 날짜 범위 다운로드)
- 오프라인 큐 (queueSync, processQueue)
- 동기화 상태 관리 (lastSyncedAt, syncStatus)
```

---

이 기획서는 기존 PRD를 확장하여 로그인/동기화 기능을 추가한 것입니다. MVP 우선순위에 따라 단계적으로 구현하시면 됩니다.

