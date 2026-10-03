#!/usr/bin/env python3
"""fake-voice-draft-gate.py: a stand-in for the voice draft gate (a Stop hook), used only by the onboarding tests.

The tests copy it to <temporary HOME>/.claude/hooks/scripts/voice-draft-gate.py so the doctor's draft-gate-wiring check
finds a script where settings.json points. It reads the Stop input and allows the stop (prints nothing, exit 0).
"""
import sys

sys.stdin.read()
