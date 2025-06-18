FROM node:22-bullseye

# Switch to root user explicitly
USER root

# Set working directory
WORKDIR /src

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

# Copy Node environment setup to root
RUN cp -r /home/node/.bashrc /root/.bashrc
RUN cp -r /home/node/.config /root/.config

# Install Starship Prompt for root user
RUN curl -sS https://starship.rs/install.sh | sh -s -- --yes
RUN echo 'eval "$(starship init bash)"' >> /root/.bashrc

RUN yarn add -D editorconfig
