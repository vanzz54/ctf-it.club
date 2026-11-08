FROM python:3.10-alpine

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Create unprivileged user
RUN adduser -D -u 1000 ctf

# Working directory
WORKDIR /app

# Install dependencies
RUN pip install --no-cache-dir Flask

# Copy application files
COPY . .

# Set up the flag with a random name at the root
# This requires the attacker to execute RCE to list the root directory and read the flag file
RUN echo "ITCLUB{sst1_j1nj4_byp4ss_m4st3r_w1buw3ar_6621}" > /flag_8f7b2c9a.txt
RUN chmod 444 /flag_8f7b2c9a.txt

# Change ownership of the app directory
RUN chown -R ctf:ctf /app

# Switch to unprivileged user
USER ctf

# Expose port
EXPOSE 5000

# Run the application
CMD ["python", "app.py"]
