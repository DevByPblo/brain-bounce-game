export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      match_players: {
        Row: {
          clicks: number
          current_title: string | null
          display_name: string
          finished_at: string | null
          id: string
          is_bot: boolean
          joined_at: string
          match_id: string
          path: Json
          player_id: string
          time_ms: number | null
        }
        Insert: {
          clicks?: number
          current_title?: string | null
          display_name: string
          finished_at?: string | null
          id?: string
          is_bot?: boolean
          joined_at?: string
          match_id: string
          path?: Json
          player_id: string
          time_ms?: number | null
        }
        Update: {
          clicks?: number
          current_title?: string | null
          display_name?: string
          finished_at?: string | null
          id?: string
          is_bot?: boolean
          joined_at?: string
          match_id?: string
          path?: Json
          player_id?: string
          time_ms?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "match_players_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          created_at: string
          finished_at: string | null
          id: string
          is_private: boolean
          room_code: string | null
          start_title: string | null
          started_at: string | null
          status: string
          target_title: string | null
          winner_player_id: string | null
        }
        Insert: {
          created_at?: string
          finished_at?: string | null
          id?: string
          is_private?: boolean
          room_code?: string | null
          start_title?: string | null
          started_at?: string | null
          status?: string
          target_title?: string | null
          winner_player_id?: string | null
        }
        Update: {
          created_at?: string
          finished_at?: string | null
          id?: string
          is_private?: boolean
          room_code?: string | null
          start_title?: string | null
          started_at?: string | null
          status?: string
          target_title?: string | null
          winner_player_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_id: string | null
          created_at: string
          display_name: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_id?: string | null
          created_at?: string
          display_name: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_id?: string | null
          created_at?: string
          display_name?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      scores: {
        Row: {
          clicks: number
          created_at: string
          details: Json
          id: string
          mode: string
          score: number
          time_ms: number
          user_id: string
        }
        Insert: {
          clicks?: number
          created_at?: string
          details?: Json
          id?: string
          mode: string
          score: number
          time_ms?: number
          user_id: string
        }
        Update: {
          clicks?: number
          created_at?: string
          details?: Json
          id?: string
          mode?: string
          score?: number
          time_ms?: number
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_bot_to_match: {
        Args: { p_bot_name: string; p_match_id: string; p_player_id: string }
        Returns: string
      }
      cancel_match: {
        Args: { p_match_id: string; p_player_id: string }
        Returns: undefined
      }
      create_private_room: {
        Args: {
          p_display_name: string
          p_player_id: string
          p_start: string
          p_target: string
        }
        Returns: {
          match_id: string
          room_code: string
        }[]
      }
      finish_match: {
        Args: {
          p_clicks: number
          p_match_id: string
          p_path: Json
          p_player_id: string
          p_time_ms: number
        }
        Returns: undefined
      }
      join_private_room: {
        Args: { p_code: string; p_display_name: string; p_player_id: string }
        Returns: string
      }
      join_quick_match: {
        Args: {
          p_display_name: string
          p_player_id: string
          p_start: string
          p_target: string
        }
        Returns: string
      }
      migrate_anonymous_scores: {
        Args: { p_from_user: string }
        Returns: number
      }
      report_progress: {
        Args: {
          p_clicks: number
          p_current_title: string
          p_match_id: string
          p_path: Json
          p_player_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
