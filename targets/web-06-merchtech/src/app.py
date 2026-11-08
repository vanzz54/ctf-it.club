from flask import Flask, request, render_template, render_template_string

app = Flask(__name__)

# WAF (Web Application Firewall)
BLACKLIST_CHARS = ['.', '_', '[', ']']
BLACKLIST_WORDS = ['class', 'mro', 'subclasses', 'builtins', 'import', 'eval', 'exec', 'os', 'system', 'popen', 'subprocess', 'config']

def waf(payload):
    """
    Fungsi untuk memfilter payload SSTI.
    """
    # Check for blacklisted characters
    for char in BLACKLIST_CHARS:
        if char in payload:
            return False, f"WAF Alert: Karakter '{char}' diblokir oleh sistem keamanan kami!"
    
    # Check for blacklisted words (case-insensitive)
    payload_lower = payload.lower()
    for word in BLACKLIST_WORDS:
        if word in payload_lower:
            return False, f"WAF Alert: Kata '{word}' dilarang digunakan!"
            
    return True, ""

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/custom', methods=['GET', 'POST'])
def custom():
    if request.method == 'POST':
        message = request.form.get('message', '')
        
        is_safe, error_msg = waf(message)
        if not is_safe:
            # WAF blocked the request
            return render_template('custom.html', error=error_msg, original_message=message)
        
        # VULNERABLE CODE: Rendering user input directly via template string
        template = f'''
        {{% extends "custom.html" %}}
        {{% block preview %}}
        <div class="mt-12 max-w-md mx-auto relative bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <h3 class="text-sm font-bold text-gray-500 tracking-widest uppercase p-4 text-center border-b border-gray-100">Live Preview</h3>
            
            <div class="relative w-full aspect-[4/5] bg-gray-50 flex items-center justify-center">
                <!-- Gambar Kaos Polos -->
                <img src="{{{{ url_for('static', filename='images/blank_shirt.png') }}}}" alt="Kaos Polos" class="absolute inset-0 w-full h-full object-cover opacity-95" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                
                <!-- Fallback Icon jika gambar belum ada -->
                <div class="absolute inset-0 flex flex-col items-center justify-center text-gray-300 hidden bg-gray-50">
                    <span class="text-6xl mb-4">👕</span>
                    <span class="text-xs px-4 text-center">(Simpan file "blank_shirt.png" di folder static/images/)</span>
                </div>

                <!-- Teks Sablon di Atas Kaos -->
                <div class="absolute inset-0 flex items-center justify-center px-10 pb-16 pt-12 pointer-events-none">
                    <p class="text-xl font-bold text-gray-900 font-mono text-center break-words bg-white/80 backdrop-blur-sm px-6 py-3 rounded shadow-sm border border-gray-200 w-full transform -translate-y-4">
                        {message}
                    </p>
                </div>
            </div>
        </div>
        {{% endblock %}}
        '''
        try:
            return render_template_string(template)
        except Exception as e:
            return render_template('custom.html', error=f"Template Error: Invalid syntax.", original_message=message)
            
    return render_template('custom.html')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
