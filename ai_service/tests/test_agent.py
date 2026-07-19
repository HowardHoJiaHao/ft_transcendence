import asyncio
import unittest

from langchain_core.messages import AIMessage

import agent


class FakeGraph:
    def __init__(self):
        self.config = None

    async def ainvoke(self, payload, config=None):
        self.config = config
        await asyncio.sleep(0.01)
        user_messages = [
            message.content
            for message in payload["messages"]
            if message.type == "human"
        ]
        return {
            "messages": [
                *payload["messages"],
                AIMessage(content=f"Answer for {user_messages[-1]}"),
            ]
        }


class FakeLLM:
    async def ainvoke(self, _messages):
        return AIMessage(content="Rewritten clean answer with enough words.")


class LimitGraph:
    async def ainvoke(self, payload, config=None):
        return {
            "messages": [
                *payload["messages"],
                AIMessage(
                    content="",
                    tool_calls=[
                        {"name": "search_listings", "args": {}, "id": "call-1"}
                    ],
                ),
            AIMessage(content="Model call limits exceeded: run limit (10/10)"),
            ]
        }


class AgentTests(unittest.IsolatedAsyncioTestCase):
    def test_current_frontend_message_is_not_duplicated(self):
        messages = agent.build_request_messages(
            [{"role": "user", "content": "Find a 5U racket"}],
            "Find a 5U racket",
        )
        human = [message for message in messages if message.type == "human"]
        self.assertEqual(len(human), 1)

    def test_structured_profile_becomes_request_context(self):
        messages = agent.build_request_messages(
            [{"role": "assistant", "content": "What budget range should I stay within?"}],
            "__recommendation_assessment_complete__",
            {
                "age_group": "18-25",
                "gender": "prefer_not_to_say",
                "experience_level": "less_than_6_months",
                "play_style": "defensive",
                "budget_range": "200-400",
            },
        )
        self.assertEqual(len(messages), 1)
        self.assertIn("Assessment profile", messages[-1].content)
        self.assertNotIn("__recommendation_assessment_complete__", messages[-1].content)

    async def test_parallel_runs_do_not_share_history(self):
        graph = FakeGraph()
        bot = agent.RacketBotAgent(graph=graph, llm=FakeLLM())
        first, second = await asyncio.gather(
            bot.run(history=[], message="first request"),
            bot.run(history=[], message="second request"),
        )
        self.assertEqual(first.answer, "Answer for first request")
        self.assertEqual(second.answer, "Answer for second request")
        self.assertEqual(graph.config["recursion_limit"], 64)

    async def test_limit_message_is_not_exposed_as_an_answer(self):
        bot = agent.RacketBotAgent(graph=LimitGraph(), llm=FakeLLM())
        with self.assertRaises(agent.AgentLimitReachedError) as context:
            await bot.run(
                history=[
                    {"role": "assistant", "content": "What budget range should I stay within?"}
                ],
                message="Find a racket",
            )
        self.assertEqual(str(context.exception), agent.MODEL_LIMIT_FALLBACK)

    def test_validator_rejects_raw_envelope_and_guest_pii(self):
        self.assertFalse(
            agent.validate_answer(
                'Here is data {"permission": "private"}', authenticated=True
            )[0]
        )
        self.assertFalse(
            agent.validate_answer(
                "The email is user@example.com", authenticated=False
            )[0]
        )
        self.assertTrue(
            agent.validate_answer(
                "A 5U flexible racket is easier to handle.", authenticated=False
            )[0]
        )

    def test_validator_rejects_markdown_tables(self):
        answer = """Comparison
| Product | Price |
|---|---|
| Racket A | RM200 |
"""
        valid, reason = agent.validate_answer(answer, authenticated=False)
        self.assertFalse(valid)
        self.assertEqual(reason, "markdown_table")


if __name__ == "__main__":
    unittest.main()
