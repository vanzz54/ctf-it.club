import json, sys, os

DATA_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "challenges.json")

def load_flag():
    with open(DATA_FILE, "r") as f:
        challenges = json.load(f)
    for ch in challenges:
        if ch["id"] == "f1-tuli":
            return ch["flag"]
    return None

def validate_flag(user_input):
    expected = load_flag()
    if expected is None:
        return False, "Challenge tidak ditemukan"
    if len(user_input) != len(expected):
        return False, "FLAG SALAH"
    result = 0
    for a, b in zip(user_input.encode(), expected.encode()):
        result |= a ^ b
    return result == 0, ("CORRECT" if result == 0 else "INCORRECT")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: checker.py <flag>", file=sys.stderr)
        sys.exit(1)
    correct, msg = validate_flag(sys.argv[1])
    print(msg)
    sys.exit(0 if correct else 1)
