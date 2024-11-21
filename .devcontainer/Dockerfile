FROM node:20-bullseye

# Install necessary packages
RUN apt-get update && apt-get install -y \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Starship
RUN curl -sS https://starship.rs/install.sh | sh -s -- --yes

# Install TypeScript globally
RUN npm install -g typescript ts-node ts-node-dev

# Switch to node user
USER node

# Create directory for Starship config
RUN mkdir -p /home/node/.config

# Add Starship init to bash
RUN echo 'eval "$(starship init bash)"' >> /home/node/.bashrc

# Copy Starship configuration
COPY --chown=node:node starship.toml /home/node/.config/starship.toml

# Set timezone (optional)
ENV TZ=Asia/Kuala_Lumpur
