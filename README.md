# korea-job-collector

개인 취업 준비용 채용공고 수집·관리 도구입니다.

국내 채용 사이트의 공식 Open API와 채용 알림 메일에서 희망 조건(지역, 직무, 경력)에 맞는 공고를 모으고, 중복을 제거해 정리합니다. 정리한 공고는 [career-ops](https://github.com/career-ops-hq/career-ops)의 파이프라인으로 넘겨 평가와 지원 관리에 사용합니다.

> 개발 중인 프로젝트입니다.

## 데이터 출처

공식적으로 허용된 경로만 사용합니다. 채용 사이트를 크롤링하거나 차단을 우회하지 않습니다.

- [사람인 Open API](https://oapi.saramin.co.kr/)
- [경기도 잡아바 채용정보 API](https://www.data.go.kr/data/15119896/openapi.do) (공공데이터포털)
- 본인 Gmail로 받은 채용 알림 메일 (읽기 전용)

## 이용 원칙

- 비상업적 용도이며, 본인 1인만 사용합니다.
- 수집한 공고 데이터는 저장소에 올리거나 재배포하지 않습니다.
- API 키와 인증 정보는 `.env`에만 보관하고 커밋하지 않습니다.
- 지원서 제출은 자동화하지 않습니다. 평가와 정리까지만 하고, 지원은 사람이 직접 합니다.

## License

MIT

---

Powered by <a href="http://www.saramin.co.kr" target="_blank">취업 사람인</a>
