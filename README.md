# korea-job-collector

개인 취업 준비용 채용공고 수집·관리 도구입니다.

국내 채용 사이트의 공식 Open API와 채용 알림 메일에서 희망 조건(지역, 직무, 경력)에 맞는 공고를 모으고, 중복을 제거해 정리합니다. 정리한 공고는 [career-ops](https://github.com/career-ops-hq/career-ops)의 파이프라인으로 넘겨 평가와 지원 관리에 사용합니다.

> 개발 중인 프로젝트입니다.

## 데이터 출처

공식적으로 허용된 경로만 사용합니다. 채용 사이트를 크롤링하거나 차단을 우회하지 않습니다.

- [사람인 Open API](https://oapi.saramin.co.kr/)
- [경기도 잡아바 채용정보 API](https://www.data.go.kr/data/15119896/openapi.do) (공공데이터포털)
- 본인 Gmail로 받은 채용 알림 메일 (읽기 전용)

## 구성

| 플러그인 | 상태 | 내용 |
|---|---|---|
| `plugins/saramin` | 동작 (API 키 대기) | 키워드·지역별로 사람인 공고를 모아 신입 / 신입·경력 / 경력무관만 남김 |
| `plugins/jobaba` | 동작 (API 키 대기) | 경기도 잡아바 공고에서 마감 안 된 신입 / 신입·경력 / 경력무관 공고를 희망 도시만 남김 |
| 채용 알림 메일 | 예정 | career-ops 기본 Gmail 플러그인 + 한국 사이트 링크 정리 |

각 플러그인은 career-ops의 `ingest` 플러그인입니다. 수집한 공고를 반환하면 career-ops가 제목 필터, 블랙리스트, 중복 제거를 적용해 파이프라인에 넣습니다.

## 설치

Node.js 22 이상과 [career-ops](https://github.com/career-ops-hq/career-ops) 설치본이 필요합니다.

```powershell
# 1. 플러그인을 career-ops의 plugins.local/에 연결 (디렉터리 정션, 관리자 권한 불필요)
.\scripts\install.ps1 -CareerOps C:\path\to\career-ops

# 2. config/plugins.example.yml의 saramin, jobaba 블록을 career-ops/config/plugins.yml에 추가

# 3. career-ops/.env에 키 추가
#    SARAMIN_ACCESS_KEY=사람인에서 발급받은 키
#    GG_OPENAPI_KEY=경기데이터드림에서 발급받은 인증키

# 4. 실행 (career-ops 폴더에서)
node plugins.mjs run saramin
node plugins.mjs run jobaba
```

플러그인 코드를 고친 뒤에는 career-ops가 변경을 감지하고 실행을 막습니다. 변경 내용을 확인한 뒤 `node plugins.mjs trust <플러그인 id>`로 다시 신뢰 등록하세요.

## 테스트

```powershell
npm test
```

네트워크 없이 가짜 응답으로 페이지 넘김, 경력 필터, 중복 제거, 하루 호출 한도, 에러 처리, 키가 로그에 남지 않는지를 확인합니다.

## 참고: 사람인 API 실제 동작

- 잘못된 키는 명세의 `result.code`가 아니라 최상위 `{"code": 2, "message": "..."}`로 응답합니다 (HTTP 200).
- 호출 한도: 하루 500회, 한 번에 최대 110건. 공고 본문은 주지 않고 요약 필드와 URL만 줍니다.

## 참고: 잡아바 API 실제 동작

- 요청 변수는 `KEY`, `Type`, `pIndex`, `pSize`뿐이고 지역·경력·날짜 검색이 없습니다. 그래서 전체를 페이지 단위로 받고 플러그인에서 거릅니다. 전체 건수는 약 46만 건(마감 공고 포함)입니다.
- 데이터가 뒤에 계속 덧붙는 구조라 1페이지가 가장 오래됐고 마지막 페이지가 최신입니다. 같은 공고가 여러 번 들어 있습니다(마지막 2만여 행 중 서로 다른 공고는 약 3,900건). 그래서 마지막 페이지부터 거꾸로 읽고, 링크로 중복을 없앱니다.
- career-ops는 플러그인 한 번 실행을 15초에 끊습니다. 페이지당 약 0.7초라서 8페이지씩 동시에 받고, 12초가 지나면 그때까지 모은 결과를 돌려줍니다.
- 요청에 `Accept: application/json` 헤더를 붙이면 HTTP 500이 납니다. 헤더 없이 `Type=json`만 씁니다.
- 응답은 JSON인데 `Content-Type`은 `text/html`입니다.
- 키 없이 부르면 고정된 샘플 5건만 줍니다. 잘못된 키는 HTTP 200에 `{"RESULT": {"CODE": "ERROR-290", ...}}`로 응답합니다.
- 공고 링크는 원래 사이트(잡아바, 잡코리아, 고용24)로 연결됩니다.

## 이용 원칙

- 비상업적 용도이며, 본인 1인만 사용합니다.
- 수집한 공고 데이터는 저장소에 올리거나 재배포하지 않습니다.
- API 키와 인증 정보는 `.env`에만 보관하고 커밋하지 않습니다.
- 지원서 제출은 자동화하지 않습니다. 평가와 정리까지만 하고, 지원은 사람이 직접 합니다.

## License

MIT

---

잡아바 채용정보 출처: 경기도 (경기데이터드림)

Powered by <a href="http://www.saramin.co.kr" target="_blank">취업 사람인</a>
