import asyncio
import json
import unittest

import main
from agent import AgentRunResult
from tools import auth_token_var


class RecordingAgent:
    def __init__(self):
        self.seen = []

    async def run(self, *, history, message, recommendation_profile=None):
        before = auth_token_var.get()
        await asyncio.sleep(0.01)
        after = auth_token_var.get()
        self.seen.append(
            (message, before, after, list(history), recommendation_profile)
        )
        return AgentRunResult(
            answer=f"Completed answer for {message} with grounded facts.",
            tools_called=(),
            model_calls=1,
            tool_calls=0,
        )

    async def rewrite_answer(self, *, user_message, draft):
        return draft


async def response_text(response):
    pieces = []
    async for item in response.body_iterator:
        pieces.append(item.decode() if isinstance(item, bytes) else item)
    return "".join(pieces)


def sse_answer(payload):
    answer = ""
    for line in payload.splitlines():
        if not line.startswith("data: ") or line == "data: [DONE]":
            continue
        answer += json.loads(line[6:])["token"]
    return answer


class MainConcurrencyTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.original_agent = main.agent_instance
        self.agent = RecordingAgent()
        main.agent_instance = self.agent

    async def asyncTearDown(self):
        main.agent_instance = self.original_agent

    async def test_interleaved_requests_keep_auth_and_history_isolated(self):
        first_request = main.ChatRequest(
            message="first",
            history=[main.ChatMessage(role="user", content="history one")],
            userId=1,
            authToken="token-one",
        )
        second_request = main.ChatRequest(
            message="second",
            history=[main.ChatMessage(role="user", content="history two")],
            userId=2,
            authToken="token-two",
        )
        first_response, second_response = await asyncio.gather(
            main.chat_endpoint(first_request),
            main.chat_endpoint(second_request),
        )
        first_text, second_text = await asyncio.gather(
            response_text(first_response),
            response_text(second_response),
        )
        self.assertIn("Completed answer for first", sse_answer(first_text))
        self.assertIn("Completed answer for second", sse_answer(second_text))
        by_message = {record[0]: record for record in self.agent.seen}
        self.assertEqual(by_message["first"][1:3], ("token-one", "token-one"))
        self.assertEqual(by_message["second"][1:3], ("token-two", "token-two"))
        self.assertEqual(by_message["first"][3][0]["content"], "history one")
        self.assertEqual(by_message["second"][3][0]["content"], "history two")

    async def test_recommendation_profile_is_validated_and_normalized(self):
        request = main.ChatRequest(
            message="__recommendation_assessment_complete__",
            recommendationProfile={
                "age_group": "under-13",
                "gender": "prefer_not_to_say",
                "experience_level": "6_months-1_year",
                "play_style": "not_sure",
                "budget_range": "under-200",
                "unexpected": "ignore me",
            },
        )
        response = await main.chat_endpoint(request)
        await response_text(response)

        normalized = self.agent.seen[-1][4]
        self.assertEqual(normalized["age_group"], "under_13")
        self.assertEqual(normalized["experience_level"], "6_months_1_year")
        self.assertEqual(normalized["budget_range"], "under_200")
        self.assertNotIn("unexpected", normalized)

    async def test_invalid_recommendation_profile_never_reaches_agent(self):
        request = main.ChatRequest(
            message="__recommendation_assessment_complete__",
            recommendationProfile={"age_group": "18-25"},
        )
        response = await main.chat_endpoint(request)
        answer = sse_answer(await response_text(response))

        self.assertIn("incomplete or invalid", answer)
        self.assertEqual(self.agent.seen, [])


if __name__ == "__main__":
    unittest.main()
