FROM node:20-bullseye

# Install necessary packages including tzdata
RUN apt-get update && apt-get install -y \
    curl \
    git \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

# Set timezone
ENV TZ=Asia/Kuala_Lumpur
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# Install Starship
RUN curl -sS https://starship.rs/install.sh | sh -s -- --yes

# Install TypeScript globally
RUN npm install -g npm@latest

# Create directory for Starship config
RUN mkdir -p /home/node/.config

# Add Starship init to bash
RUN echo 'eval "$(starship init bash)"' >> /home/node/.bashrc

# Copy Starship configuration
COPY --chown=node:node starship.toml /home/node/.config/starship.toml

# Lint and format code during the build
RUN yarn lint || true
RUN yarn format || true

RUN yarn add -D editorconfig