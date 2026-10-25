import unittest

from assistants.language_mentor.tools.understanding import present_understanding_check
from assistants.language_mentor.tools.sentence_structure import present_sentence_structure
from assistants.language_mentor.tools.synonyms import present_synonyms


class UnderstandingTests(unittest.TestCase):
    def test_outputs_safe_openui_program(self):
        result = present_understanding_check.invoke({"question": 'Meaning of "probabilistic"?', "options": ["Always wrong", "Based on probability"]})
        self.assertEqual(result["type"], "understanding_check")
        self.assertEqual(result["version"], 1)
        self.assertEqual(result["response"], 'root = UnderstandingCheck("Meaning of \\"probabilistic\\"?", ["Always wrong", "Based on probability"])')
        self.assertNotIn("correct_answer", result)

    def test_rejects_invalid_questions(self):
        for question, options in [(" ", ["A", "B"]), ("Q", ["A"]), ("Q", ["A", "A"]), ("Q", ["A", " "]), ("Q", ["A", "x" * 601])]:
            with self.subTest(question=question, options=options):
                self.assertIn("error", present_understanding_check.invoke({"question": question, "options": options}))


class SynonymTests(unittest.TestCase):
    def test_emits_distinctions_for_related_words_and_phrase_input(self):
        payload = {
            "source": "provide", "shared_meaning": "都可表示向人提供所需之物，但侧重点不同。",
            "source_distinction": "强调向某人提供其所需的资源或支持。", "source_example": "The school provides free meals.",
            "alternatives": [
                {"term": "offer", "distinction": "强调主动提出，对方可以拒绝。", "example": "She offered me a job."},
                {"term": "supply", "distinction": "强调持续供给所需资源。", "example": "The company supplies water."},
            ],
        }
        result = present_synonyms.invoke(payload)
        self.assertEqual(result, {"type": "synonym_comparison", "version": 1, **payload})
        self.assertEqual(present_synonyms.invoke({**payload, "source": "take into account"})["source"], "take into account")

    def test_rejects_empty_duplicates_and_untrusted_extra_fields(self):
        base = {
            "source": "provide", "shared_meaning": "提供", "source_distinction": "提供所需帮助", "source_example": "They provide shelter.", "alternatives": [
                {"term": "offer", "distinction": "主动提出", "example": "I offer help."},
            ],
        }
        cases = [
            {**base, "source": " "},
            {**base, "source_distinction": " "},
            {**base, "source_example": " "},
            {**base, "alternatives": []},
            {**base, "alternatives": [{**base["alternatives"][0], "term": "PROVIDE"}]},
            {**base, "alternatives": base["alternatives"] + [{**base["alternatives"][0], "term": "Offer"}]},
            {**base, "alternatives": [{**base["alternatives"][0], "distinction": " "}]},
            {**base, "alternatives": [{**base["alternatives"][0], "response": "root = Query(\"bad\")"}]},
        ]
        for payload in cases:
            with self.subTest(payload=payload):
                self.assertIn("error", present_synonyms.invoke(payload))

    def test_mentor_registers_synonym_tool(self):
        from assistants.language_mentor.tools import LOCAL_TOOLS
        self.assertIn("present_synonyms", [tool.name for tool in LOCAL_TOOLS])


class SentenceStructureTests(unittest.TestCase):
    def test_preserves_exact_source_and_explains_english_predicative(self):
        result = present_sentence_structure.invoke({
            "sentence": "She is happy.",
            "summary": "is 将主语和描述她的 happy 联系起来。",
            "segments": [
                {"text": "She ", "role": "subject", "attaches_to": 1, "reason": "谁是 happy？"},
                {"text": "is ", "role": "predicate", "attaches_to": None, "reason": "连接主语和状态。"},
                {"text": "happy.", "role": "predicative", "attaches_to": 1, "reason": "说明主语的状态，而非动作宾语。"},
            ],
        })
        self.assertEqual(result["type"], "sentence_structure")
        self.assertEqual(result["version"], 1)
        self.assertEqual("".join(segment["text"] for segment in result["segments"]), "She is happy.")
        self.assertEqual(result["segments"][2]["role"], "predicative")

    def test_accepts_ordered_explanation_points_without_requiring_all_three_kinds(self):
        payload = {
            "sentence": "She is happy.", "summary": "She 的状态是 happy。",
            "segments": [{"text": "She is happy.", "role": "clause", "attaches_to": None, "reason": "完整句子。"}],
            "explanation_steps": [
                {"kind": "backbone", "text": "She 是主语，is 连接状态 happy。"},
                {"kind": "pitfall", "text": "happy 说明主语，不是宾语。"},
            ],
        }
        result = present_sentence_structure.invoke(payload)
        self.assertEqual(result["explanation_steps"], payload["explanation_steps"])
        self.assertEqual(present_sentence_structure.invoke({key: value for key, value in payload.items() if key != "explanation_steps"})["explanation_steps"], [])
        for bad_steps in [[{"kind": "other", "text": "错误分类"}], [{"kind": "backbone", "text": " "}],
                          [{"kind": "backbone", "text": "x" * 501}],
                          [{"kind": "backbone", "text": "a"}] * 4]:
            with self.subTest(bad_steps=bad_steps):
                self.assertIn("error", present_sentence_structure.invoke({**payload, "explanation_steps": bad_steps}))

    def test_mentor_can_call_sentence_structure_tool(self):
        from assistants.language_mentor.tools import LOCAL_TOOLS
        self.assertIn("present_sentence_structure", [tool.name for tool in LOCAL_TOOLS])

    def test_rejects_hallucinated_text_and_invalid_relations(self):
        segments = [
            {"text": "She ", "role": "subject", "attaches_to": 1, "reason": "主语"},
            {"text": "is happy.", "role": "predicate", "attaches_to": None, "reason": "谓语"},
        ]
        payload = {"sentence": "She is happy.", "summary": "句子主干", "segments": segments}
        self.assertIn("error", present_sentence_structure.invoke({**payload, "sentence": "She was happy."}))
        self.assertIn("error", present_sentence_structure.invoke({**payload, "segments": [{**segments[0], "attaches_to": 9}, segments[1]]}))
        self.assertIn("error", present_sentence_structure.invoke({**payload, "segments": [{**segments[0], "role": "javascript"}, segments[1]]}))
        self.assertIn("error", present_sentence_structure.invoke({**payload, "segments": [{**segments[0], "attaches_to": 0}, segments[1]]}))
        self.assertIn("error", present_sentence_structure.invoke({**payload, "segments": [segments[0], {**segments[1], "attaches_to": 0}]}))
