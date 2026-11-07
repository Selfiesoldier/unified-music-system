with open("test_worker.m4a", "rb") as f:
    data = f.read()

import re
strings = re.findall(b'[\x20-\x7E]{5,}', data)
for s in strings[:30]:
    try:
        print(s.decode('latin1'))
    except:
        pass
