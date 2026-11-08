title: The Exfiltration Route
value: 732
description: In addition to seizing the disk image from the ransomware-infected server, the CyberNusa Security Operations Center (SOC) team also successfully intercepted and extracted the network traffic recording moments before the malware was executed.

Based on preliminary analysis, the attacker performed several activities over the network:
1. Downloading an additional *payload*.
2. Exfiltrating (stealing) the company's database.
3. Communicating with the Command & Control (C2) Server using a noisy yet stealthy *Tunneling* technique.

Download the PCAP file below and dissect its *traffic*. Gather evidence from the HTTP, FTP, and DNS protocols. The attacker shattered their final secret message into pieces in the air.

Once you have gathered all the findings, report your investigation results to the CyberNusa Incident Validation Portal via the Netcat connection below to obtain the **Flag**.

**Additional Information**
- Flag Format: `ITCLUB{...}`
- `nc <SERVER_IP> 10003`